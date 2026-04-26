import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getConsultationPlanPath,
  getConsultationPlanReadinessPath,
  getConsultationPlanReviewPath,
  getPlanConsensusPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getPlanningSpecPath,
  getPreflightReadinessPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../src/core/paths.js";
import {
  buildSavedConsultationStatus,
  consultationPlanArtifactSchema,
  consultationPlanReadinessSchema,
  consultationPlanReviewSchema,
  planConsensusArtifactSchema,
  planningDepthArtifactSchema,
  planningInterviewArtifactSchema,
  planningSpecArtifactSchema,
  runManifestSchema,
} from "../src/domain/run.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import { loadProjectConfig } from "../src/services/project.js";
import {
  answerPlanRun,
  planRun,
  readLatestExportableRunId,
  readLatestRunId,
} from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";
import { normalizePathForAssertion } from "./helpers/platform.js";
import {
  createInitializedProject,
  createTempProject,
  registerProjectFlowsTempRootCleanup,
  writeProjectFlowFile,
} from "./helpers/project-flows.js";

registerProjectFlowsTempRootCleanup();

describe("project flows planning", () => {
  it("plans a run with candidate manifests", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 3,
    });

    const saved = runManifestSchema.parse(
      JSON.parse(await readFile(getRunManifestPath(cwd, manifest.id), "utf8")) as unknown,
    );

    expect(saved.agent).toBe("codex");
    expect(saved.candidates).toHaveLength(3);
    expect(saved.candidates[0]?.id).toBe("cand-01");
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(saved.outcome).toMatchObject({
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount: 0,
      judgingBasisKind: "unknown",
      validationPosture: "unknown",
      validationGapCount: 0,
    });
    expect(buildSavedConsultationStatus(saved).nextActions).toEqual(["reopen-verdict"]);
    expect(buildSavedConsultationStatus(saved).validationProfileId).toBeUndefined();
    expect(buildSavedConsultationStatus(saved).validationSummary).toBeUndefined();
    expect(buildSavedConsultationStatus(saved).validationSignals).toEqual([]);
    expect(buildSavedConsultationStatus(saved).validationGaps).toEqual([]);
    expect(buildSavedConsultationStatus(saved).validationGapsPresent).toBe(false);
    expect(buildSavedConsultationStatus(saved).researchRerunRecommended).toBe(false);
    expect(buildSavedConsultationStatus(saved).researchRerunInputPath).toBeUndefined();
  });

  it("resolves nested invocation to the nearest initialized Oraculum root", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await writeProjectFlowFile(nested, "tasks/fix-session-loss.md", "# fix nested package\n");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 1,
    });

    expect(resolveProjectRoot(nested)).toBe(cwd);
    expect(manifest.taskPath).toBe(join(nested, "tasks", "fix-session-loss.md"));
    const saved = runManifestSchema.parse(
      JSON.parse(await readFile(getRunManifestPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(saved.taskPath).toBe(join(nested, "tasks", "fix-session-loss.md"));
  });

  it("prefers invocation-directory task files over same-named project-root task files", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await writeProjectFlowFile(cwd, "tasks/fix.md", "# root task\n");
    await writeProjectFlowFile(nested, "tasks/fix.md", "# nested task\n");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix.md",
      agent: "codex",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(nested, "tasks", "fix.md"));
    expect(manifest.taskPacket.title).toBe("nested task");
  });

  it("falls back to project-root task files from nested invocations", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeProjectFlowFile(cwd, "tasks/fix.md", "# root task\n");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix.md",
      agent: "codex",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(cwd, "tasks", "fix.md"));
    expect(manifest.taskPacket.title).toBe("root task");
  });

  it("keeps uninitialized nested directories local instead of guessing a repository root", async () => {
    const cwd = await createTempProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(nested, { recursive: true });

    expect(resolveProjectRoot(nested)).toBe(nested);
  });

  it("rejects candidate counts above the supported maximum before creating a consultation", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");

    await expect(
      planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        candidates: 17,
      }),
    ).rejects.toThrow("Candidate count must be 16 or less.");
    await expect(readdir(join(cwd, ".oraculum", "runs"))).resolves.toEqual([]);
  });

  it("materializes inline task input without updating latest run state before execution", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "Update src/greet.js so greet() returns Hello instead of Bye.",
      candidates: 1,
    });

    expect(normalizePathForAssertion(manifest.taskPath)).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# Update src/greet.js so greet() returns Hello instead of Bye");
    await expect(readLatestRunId(cwd)).rejects.toThrow("Start with `orc consult ...` after setup.");
    await expect(readLatestExportableRunId(cwd)).rejects.toThrow(
      "No crownable consultation found yet",
    );
  });

  it("asks for a clarification before writing a runnable plan for underspecified work", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"decision":"needs-clarification","confidence":"medium","summary":"The plan lacks a result contract and judging basis.","researchPosture":"repo-only","clarificationQuestion":"Which user-visible flow, affected files, and acceptance checks should the plan bind?"}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      candidates: 1,
      requirePlanningClarification: true,
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    expect(manifest.status).toBe("completed");
    expect(manifest.candidateCount).toBe(0);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.preflight).toMatchObject({
      decision: "needs-clarification",
      clarificationQuestion:
        "Which user-visible flow, affected files, and acceptance checks should the plan bind?",
    });

    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(planArtifact.readyForConsult).toBe(false);
    expect(planArtifact.openQuestions).toContain(
      "Which user-visible flow, affected files, and acceptance checks should the plan bind?",
    );
    expect(planArtifact.recommendedNextAction).toContain("orc answer");
    await expect(
      readFile(
        join(cwd, ".oraculum", "runs", manifest.id, "reports", "preflight-judge.prompt.txt"),
        "utf8",
      ),
    ).resolves.toContain("Planning lane contract:");

    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, manifest.id), "utf8"),
    ) as {
      recommendation?: { decision?: string; clarificationQuestion?: string };
    };
    expect(readiness.recommendation).toMatchObject({
      decision: "needs-clarification",
      clarificationQuestion:
        "Which user-visible flow, affected files, and acceptance checks should the plan bind?",
    });
  });

  it("folds clarification answers into the planned candidate task contract", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      clarificationAnswer:
        "Email/password login only; protect /dashboard; keep OAuth out of scope.",
      candidates: 1,
      requirePlanningClarification: true,
    });

    expect(manifest.status).toBe("planned");
    expect(manifest.candidateCount).toBe(1);
    expect(manifest.preflight).toBeUndefined();

    const taskPacketPath = manifest.candidates[0]?.taskPacketPath;
    if (!taskPacketPath) {
      throw new Error("Expected a planned candidate task packet path.");
    }
    const taskPacket = materializedTaskPacketSchema.parse(
      JSON.parse(await readFile(taskPacketPath, "utf8")) as unknown,
    );
    expect(taskPacket.intent).toContain("Planning clarification answer:");
    expect(taskPacket.intent).toContain("Email/password login only");
    expect(taskPacket.acceptanceCriteria).toContain(
      "Plan must honor the operator clarification: Email/password login only; protect /dashboard; keep OAuth out of scope.",
    );
  });

  it("writes a ready plan-readiness artifact when a clarification answer completes a plan contract", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      clarificationAnswer:
        "Email/password login only; protect /dashboard; keep OAuth out of scope.",
      candidates: 1,
      requirePlanningClarification: true,
      writeConsultationPlanArtifacts: true,
    });

    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    const summary = await renderConsultationSummary(manifest, cwd);

    expect(readiness).toMatchObject({
      status: "clear",
      readyForConsult: true,
      unresolvedQuestions: [],
      reviewStatus: "not-run",
    });
    expect(readiness.nextAction).toContain("orc consult");
    expect(summary).toContain(
      `- consultation plan path: .oraculum/runs/${manifest.id}/reports/consultation-plan.json.`,
    );
    expect(summary).toContain(
      `- execute the persisted consultation plan: \`orc consult .oraculum/runs/${manifest.id}/reports/consultation-plan.json\`.`,
    );
  });

  it("stops explicit planning at the interview gate when the model asks a targeted question", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const depth = planningDepthArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningDepthPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const interview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );

    expect(manifest.candidateCount).toBe(0);
    expect(depth).toMatchObject({
      interviewDepth: "deep-interview",
      readiness: "needs-interview",
      estimatedInterviewRounds: 1,
      consensusReviewIntensity: "high",
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 10,
    });
    expect(interview).toMatchObject({
      status: "needs-clarification",
      nextQuestion: "Which auth method, protected route, and non-goals should define success?",
    });
    expect(interview.rounds[0]?.suggestedAnswers).toEqual([
      {
        label: "Email dashboard",
        description: "Use email/password login, protect /dashboard, and exclude OAuth.",
      },
      {
        label: "Session dashboard",
        description:
          "Preserve existing sessions, protect /dashboard, and avoid auth-provider expansion.",
      },
    ]);
    expect(readiness).toMatchObject({
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Which auth method, protected route, and non-goals should define success?",
      ],
    });
    expect(planArtifact.recommendedNextAction).toContain(
      `orc answer augury-question ${manifest.id} "<answer>"`,
    );
    expect(readiness.nextAction).toContain(`orc answer augury-question ${manifest.id} "<answer>"`);
  });

  it("blocks explicit planning without asking interview questions when the interview cap is zero", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(
      cwd,
      ".oraculum/advanced.json",
      `${JSON.stringify(
        {
          version: 1,
          planning: {
            explicitPlanMaxInterviewRounds: 0,
            explicitPlanMaxConsensusRevisions: 1,
            explicitPlanModelCallTimeoutMs: FAKE_AGENT_TIMEOUT_MS,
            consultLiteMaxPlanningCalls: 1,
          },
        },
        null,
        2,
      )}\n`,
    );
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const depth = planningDepthArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningDepthPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "needs-clarification",
      },
    });
    expect(depth).toMatchObject({
      readiness: "needs-interview",
      maxInterviewRounds: 0,
      operatorMaxConsensusRevisions: 1,
      maxConsensusRevisions: 1,
      estimatedInterviewRounds: 0,
    });
    await expect(
      readFile(getPlanningInterviewPath(cwd, manifest.id), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(readiness).toMatchObject({
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Add the missing result contract, scope boundaries, and judging criteria to the task text, or raise explicitPlanMaxInterviewRounds in .oraculum/advanced.json.",
      ],
    });
    expect(planArtifact.recommendedNextAction).toContain(
      `orc answer plan-clarification ${manifest.id} "<answer>"`,
    );
    expect(readiness.nextAction).toContain(
      `orc answer plan-clarification ${manifest.id} "<answer>"`,
    );
  });

  it("connects an explicit planning answer by run id and writes consensus artifacts", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const blocked = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const independentPlan = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const manifest = await answerPlanRun({
      cwd,
      runId: blocked.id,
      answer: "Email/password login only; protect /dashboard; no OAuth.",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    expect(independentPlan.taskPath).not.toBe(blocked.taskPath);
    expect(independentPlan.taskPacket.title).toContain("Email/password login only");
    const interview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const depth = planningDepthArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningDepthPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const spec = planningSpecArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningSpecPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const plan = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );

    expect(manifest.status).toBe("planned");
    expect(manifest.candidates).toHaveLength(4);
    expect(interview).toMatchObject({
      status: "ready-for-spec",
      sourceRunId: expect.any(String),
    });
    expect(depth).toMatchObject({
      interviewDepth: "skip-interview",
      consensusReviewIntensity: "elevated",
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 3,
    });
    expect(spec.goal).toBe("Add email/password authentication and protect /dashboard.");
    expect(consensus).toMatchObject({
      approved: true,
      maxRevisions: 3,
      selectedOption: {
        name: "auth-contract-first",
      },
    });
    expect(plan).toMatchObject({
      readyForConsult: true,
      planningInterviewPath: `.oraculum/runs/${manifest.id}/reports/planning-interview.json`,
      planningSpecPath: `.oraculum/runs/${manifest.id}/reports/planning-spec.json`,
      planConsensusPath: `.oraculum/runs/${manifest.id}/reports/plan-consensus.json`,
      selectedApproach: "auth-contract-first",
    });
    expect(plan.crownGates).toContain("Do not crown candidates that leave /dashboard unprotected.");
  });

  it("treats path-looking Augury answers as answers on the common answer route", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const blocked = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    await writeProjectFlowFile(
      cwd,
      "src/dashboard.ts",
      "// reporting dashboard fixture that must not replace the active Augury answer\n",
    );

    const continued = await answerPlanRun({
      cwd,
      runId: blocked.id,
      answer: "src/dashboard.ts",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const continuedInterview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, continued.id), "utf8")) as unknown,
    );

    expect(continued.status).toBe("planned");
    expect(continued.taskPath).toBe(blocked.taskPath);
    expect(continued.taskPacket.title).toBe(blocked.taskPacket.title);
    expect(continuedInterview.rounds.at(-1)).toMatchObject({
      answer: expect.stringContaining("src/dashboard.ts"),
      readyForSpec: true,
    });
    expect(continuedInterview.rounds.at(-1)?.answer).not.toContain("reporting dashboard");
  });

  it("rejects invalid explicit Augury answer routes", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const blocked = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const continued = await answerPlanRun({
      cwd,
      runId: blocked.id,
      answer: "Email/password login only; protect /dashboard; no OAuth.",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    await expect(
      answerPlanRun({
        cwd,
        runId: "run_missing",
        answer: "Protect /dashboard.",
      }),
    ).rejects.toThrow('No planning run found for Augury answer runId "run_missing"');
    const blockedDepth = planningDepthArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningDepthPath(cwd, blocked.id), "utf8")) as unknown,
    );
    await writeProjectFlowFile(
      cwd,
      `.oraculum/runs/${blocked.id}/reports/planning-depth.json`,
      `${JSON.stringify({ ...blockedDepth, maxInterviewRounds: 0 }, null, 2)}\n`,
    );
    await expect(
      answerPlanRun({
        cwd,
        runId: blocked.id,
        answer: "Protect /dashboard.",
      }),
    ).rejects.toThrow("exhausted the Augury Interview round cap");
    await expect(
      answerPlanRun({
        cwd,
        runId: blocked.id,
        answer: "   ",
      }),
    ).rejects.toThrow("Augury answer must not be blank.");
    await expect(
      answerPlanRun({
        cwd,
        runId: continued.id,
        answer: "Another answer.",
      }),
    ).rejects.toThrow("does not have an active Augury Interview");
  });

  it("blocks explicit planning without staging candidates when consensus misses the revision cap", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(
      cwd,
      ".oraculum/advanced.json",
      `${JSON.stringify(
        {
          version: 1,
          planning: {
            explicitPlanMaxInterviewRounds: 1,
            explicitPlanMaxConsensusRevisions: 0,
            explicitPlanModelCallTimeoutMs: FAKE_AGENT_TIMEOUT_MS,
            consultLiteMaxPlanningCalls: 1,
          },
        },
        null,
        2,
      )}\n`,
    );
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "revise",
    });

    const manifest = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const depth = planningDepthArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningDepthPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "abstained-before-execution",
      },
    });
    expect(depth).toMatchObject({
      consensusReviewIntensity: "elevated",
      operatorMaxConsensusRevisions: 0,
      maxConsensusRevisions: 0,
    });
    expect(consensus.approved).toBe(false);
    expect(consensus.maxRevisions).toBe(0);
    expect(readiness).toMatchObject({
      status: "blocked",
      readyForConsult: false,
      blockers: ["Consensus review did not approve before the revision cap."],
      unresolvedQuestions: [],
    });
    expect(manifest.preflight).toMatchObject({
      decision: "abstain",
      summary:
        "Consensus review did not approve the explicit consultation plan before the configured revision cap.",
    });
  });

  it("treats Plan Conclave reviewer rejection as an internal planning failure", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
    });

    const manifest = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      planConsensusPath: getPlanConsensusPath(cwd, manifest.id),
    });
    const status = buildSavedConsultationStatus(manifest);

    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "abstained-before-execution",
      },
      preflight: {
        decision: "abstain",
        summary:
          "Plan Conclave rejected the explicit consultation plan before candidate generation.",
      },
    });
    expect(consensus).toMatchObject({
      approved: false,
      maxRevisions: 3,
      revisionHistory: [
        {
          revision: 1,
          summary: "Plan Conclave review rejected the draft.",
          criticReview: {
            verdict: "reject",
          },
        },
      ],
    });
    expect(consensus.revisionHistory).toHaveLength(1);
    expect(readiness).toMatchObject({
      status: "blocked",
      readyForConsult: false,
      blockers: ["Plan Conclave rejected the draft: The plan cannot proceed as written."],
      unresolvedQuestions: [],
    });
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "review-preflight-readiness",
      "revise-task-and-rerun",
    ]);
    expect(summary).toContain("Plan Conclave blocked:");
    expect(summary).toContain("Plan Conclave blocker: rejected");
    expect(summary).toContain("Tighten crown gates before consult.");
    expect(review.recommendationAbsenceReason).toContain(
      "Execution was declined before candidate generation.",
    );
    expect(review.artifactAvailability.planConsensus).toBe(true);
  });

  it("turns a Plan Conclave task clarification into an Augury question", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      taskClarificationQuestion: true,
    });

    const manifest = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const interview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );

    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      outcome: { type: "needs-clarification" },
      preflight: {
        decision: "needs-clarification",
        clarificationQuestion: "Which user-visible success signal should candidates prove?",
      },
    });
    expect(consensus).toMatchObject({
      approved: false,
      revisionHistory: [
        {
          summary: "Plan Conclave requested Augury clarification.",
          criticReview: {
            taskClarificationQuestion: "Which user-visible success signal should candidates prove?",
          },
        },
      ],
    });
    expect(interview).toMatchObject({
      status: "needs-clarification",
      nextQuestion: "Which user-visible success signal should candidates prove?",
      rounds: [
        expect.objectContaining({
          perspective: "plan-conclave-task-clarification",
          expectedAnswerShape:
            "Answer with the missing task intent, scope boundary, success criteria, non-goal, or judging basis.",
        }),
      ],
    });
    expect(readiness).toMatchObject({
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: ["Which user-visible success signal should candidates prove?"],
    });
    expect(buildSavedConsultationStatus(manifest).nextActions).toEqual([
      "reopen-verdict",
      "review-preflight-readiness",
      "answer-clarification-and-rerun",
    ]);
  });

  it("abstains instead of asking a Plan Conclave clarification after the interview budget is exhausted", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(
      cwd,
      ".oraculum/advanced.json",
      `${JSON.stringify(
        {
          version: 1,
          planning: {
            explicitPlanMaxInterviewRounds: 0,
            explicitPlanMaxConsensusRevisions: 1,
            explicitPlanModelCallTimeoutMs: FAKE_AGENT_TIMEOUT_MS,
            consultLiteMaxPlanningCalls: 1,
          },
        },
        null,
        2,
      )}\n`,
    );
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      taskClarificationQuestion: true,
    });

    const manifest = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      outcome: { type: "abstained-before-execution" },
      preflight: {
        decision: "abstain",
        summary:
          "Plan Conclave found missing user intent, but the clarification budget is exhausted.",
      },
    });
    await expect(
      readFile(getPlanningInterviewPath(cwd, manifest.id), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("continues a Plan Conclave Augury clarification from the persisted source task", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      taskClarificationQuestion: true,
    });
    await writeProjectFlowFile(
      cwd,
      "tasks/auth.md",
      "# Auth plan\nEmail/password login only; protect /dashboard; no OAuth.\n",
    );

    const blocked = await planRun({
      cwd,
      taskInput: "tasks/auth.md",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    await writeProjectFlowFile(
      cwd,
      "tasks/auth.md",
      "# Reporting dashboard\nBuild a reporting dashboard for weekly metrics.\n",
    );

    const continued = await answerPlanRun({
      cwd,
      runId: blocked.id,
      answer: "Candidates must prove /dashboard redirects signed-out users.",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const blockedPlan = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, blocked.id), "utf8")) as unknown,
    );
    const continuedPlan = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, continued.id), "utf8")) as unknown,
    );
    const continuedInterview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, continued.id), "utf8")) as unknown,
    );
    const continuedSpec = planningSpecArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningSpecPath(cwd, continued.id), "utf8")) as unknown,
    );

    expect(blockedPlan.task.title).toBe("Auth plan");
    expect(continued.status).toBe("planned");
    expect(continued.taskPath).toBe(blocked.taskPath);
    expect(continued.taskPacket.title).toBe("Auth plan");
    expect(continuedPlan.task.title).toBe("Auth plan");
    expect(continuedPlan.task.intent).toContain("Email/password");
    expect(continuedPlan.task.intent).not.toContain("Candidates must prove");
    expect(continuedPlan.task.intent).not.toContain("weekly metrics");
    expect(continuedInterview.sourceRunId).toBe(blocked.id);
    expect(continuedInterview.rounds.at(-1)).toMatchObject({
      answer: expect.stringContaining(
        "Candidates must prove /dashboard redirects signed-out users.",
      ),
      readyForSpec: true,
    });
    expect(continuedSpec.assumptionsResolved).toContainEqual(
      expect.stringContaining("Candidates must prove /dashboard redirects signed-out users."),
    );
  });

  it("continues multi-round Augury by creating a fresh blocked run for the next question", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    const firstBlocked = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const secondBlocked = await answerPlanRun({
      cwd,
      runId: firstBlocked.id,
      answer: "still vague",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const firstInterview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, firstBlocked.id), "utf8")) as unknown,
    );
    const secondInterview = planningInterviewArtifactSchema.parse(
      JSON.parse(
        await readFile(getPlanningInterviewPath(cwd, secondBlocked.id), "utf8"),
      ) as unknown,
    );

    expect(secondBlocked.id).not.toBe(firstBlocked.id);
    expect(secondBlocked.taskPath).toBe(firstBlocked.taskPath);
    expect(secondBlocked.taskPacket.title).toBe(firstBlocked.taskPacket.title);
    expect(firstInterview.rounds).toHaveLength(1);
    expect(secondInterview).toMatchObject({
      status: "needs-clarification",
      sourceRunId: secondBlocked.id,
      rounds: [
        expect.objectContaining({
          answer: expect.stringContaining("still vague"),
          readyForSpec: false,
        }),
        expect.objectContaining({
          question: "Which auth method, protected route, and non-goals should define success?",
        }),
      ],
    });
  });

  it("blocks Augury without candidate generation when the interview cap is reached unclearly", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    await writeProjectFlowFile(
      cwd,
      ".oraculum/advanced.json",
      `${JSON.stringify(
        {
          version: 1,
          planning: {
            explicitPlanMaxInterviewRounds: 1,
            explicitPlanMaxConsensusRevisions: 1,
            explicitPlanModelCallTimeoutMs: FAKE_AGENT_TIMEOUT_MS,
            consultLiteMaxPlanningCalls: 1,
          },
        },
        null,
        2,
      )}\n`,
    );

    const blocked = await planRun({
      cwd,
      taskInput: "add authentication",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const capped = await answerPlanRun({
      cwd,
      runId: blocked.id,
      answer: "still vague",
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const interview = planningInterviewArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningInterviewPath(cwd, capped.id), "utf8")) as unknown,
    );

    expect(capped).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "abstained-before-execution",
      },
      preflight: {
        decision: "abstain",
      },
    });
    expect(interview).toMatchObject({
      status: "blocked",
      rounds: [
        expect.objectContaining({
          answer: expect.stringContaining("still vague"),
          readyForSpec: false,
        }),
      ],
    });
  });

  it("starts a normal planning run when stale Augury source task cannot load", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);
    await writeProjectFlowFile(cwd, "tasks/auth.md", "# Auth plan\nadd authentication\n");

    const blocked = await planRun({
      cwd,
      taskInput: "tasks/auth.md",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    await unlink(getConsultationPlanPath(cwd, blocked.id));
    await unlink(blocked.taskPath);

    const newTask = await planRun({
      cwd,
      taskInput: "Build a reporting dashboard for weekly metrics.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, newTask.id), "utf8")) as unknown,
    );

    expect(newTask.status).toBe("planned");
    expect(consensus.approved).toBe(true);
    expect(newTask.taskPacket.title).toBe("Build a reporting dashboard for weekly metrics");
  });

  it("blocks explicit planning when Plan Conclave review runtime is unavailable", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      reviewRuntimeUnavailable: true,
    });

    const manifest = await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );

    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "abstained-before-execution",
      },
      preflight: {
        decision: "abstain",
        summary:
          "Plan Conclave review runtime unavailable. Rerun planning when architect/critic review can execute.",
      },
    });
    expect(consensus).toMatchObject({
      approved: false,
      revisionHistory: [
        {
          revision: 1,
          architectReview: {
            verdict: "reject",
            summary:
              "Plan Conclave review runtime unavailable. Rerun planning when review can execute.",
          },
        },
      ],
    });
    expect(consensus.revisionHistory).toHaveLength(1);
    expect(readiness).toMatchObject({
      status: "blocked",
      readyForConsult: false,
      blockers: ["Plan Conclave review runtime unavailable."],
      unresolvedQuestions: [],
    });
  });

  it("does not treat runtime-unavailable Plan Conclave blockers as Augury targets", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      reviewRuntimeUnavailable: true,
    });

    await planRun({
      cwd,
      taskInput: "Email/password login only; protect /dashboard; no OAuth.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });
    const rerun = await planRun({
      cwd,
      taskInput:
        "Email/password login only; protect /dashboard; no OAuth. Rerun once review is available.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    await expect(readFile(getPlanningInterviewPath(cwd, rerun.id), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("treats deliberate plan review blockers as advisory unless readiness has hard blockers", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex-plan-review",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("consultation is ready to proceed before any candidate is generated")
    ? {
      decision: "proceed",
      confidence: "high",
      summary: "The task can proceed to plan review.",
      researchPosture: "repo-only",
      clarificationQuestion: null,
      researchQuestion: null
    }
    : {
      status: "blocked",
      summary: "The plan lacks a rollback crown gate.",
      blockers: ["Missing rollback crown gate."],
      warnings: [],
      riskFindings: ["Rollback risk is unbounded."],
      invariantFindings: [],
      crownGateFindings: ["Add a rollback crown gate before consult."],
      repairPolicyFindings: [],
      scorecardFindings: [],
      nextAction: "Review plan findings before consult."
    };
  fs.writeFileSync(
    out,
    JSON.stringify(body),
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "risky auth migration",
      agent: "codex",
      candidates: 1,
      deliberate: true,
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );
    const review = consultationPlanReviewSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReviewPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    const readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(
        await readFile(getConsultationPlanReadinessPath(cwd, manifest.id), "utf8"),
      ) as unknown,
    );
    const summary = await renderConsultationSummary(manifest, cwd);

    expect(planArtifact.mode).toBe("deliberate");
    expect(review.status).toBe("issues");
    expect(readiness).toMatchObject({
      status: "issues",
      readyForConsult: true,
      reviewStatus: "issues",
    });
    expect(readiness.warnings).toContain(
      "Plan review requested a block: Missing rollback crown gate.",
    );
    expect(summary).toContain("Plan review: issues");
    expect(summary).toContain("execute the persisted consultation plan");
  });

  it("guides missing project config toward consult or plan auto-init", async () => {
    const cwd = await createTempProject();

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      'Start with "orc consult <task>" or "orc plan <task>" from the project root first.',
    );
  });

  it("rejects missing task paths instead of treating them as inline text", async () => {
    const cwd = await createInitializedProject();

    await expect(
      planRun({
        cwd,
        taskInput: "tasks/missing-task.md",
        candidates: 1,
      }),
    ).rejects.toThrow("Task file not found:");
  });

  it("rejects missing source-file-looking task paths instead of treating them as inline text", async () => {
    const cwd = await createInitializedProject();

    await expect(
      planRun({
        cwd,
        taskInput: "reports/quality-review.html",
        candidates: 1,
      }),
    ).rejects.toThrow("Task file not found:");
  });

  it("rejects missing source-code-looking task paths for common non-Node extensions", async () => {
    const cwd = await createInitializedProject();

    for (const taskInput of ["src/review.py", "cmd/review.go", "crates/review.rs"]) {
      await expect(
        planRun({
          cwd,
          taskInput,
          candidates: 1,
        }),
      ).rejects.toThrow("Task file not found:");
    }
  });

  it("loads source-file-looking task paths when the file exists", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(
      cwd,
      "reports/quality-review.html",
      "<h1>Quality review</h1>\n<p>Inspect the report.</p>\n",
    );

    const manifest = await planRun({
      cwd,
      taskInput: "reports/quality-review.html",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(cwd, "reports", "quality-review.html"));
    expect(manifest.taskPacket.title).toBe("quality review");
  });

  it("treats file-like inline task text without an extension as inline text", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "fix/session-loss-on-refresh",
      candidates: 1,
    });

    expect(normalizePathForAssertion(manifest.taskPath)).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# fix/session-loss-on-refresh");
    expect(taskNote).toContain("fix/session-loss-on-refresh");
  });
});

async function createDeepPlanningCodexBinary(
  cwd: string,
  options: {
    criticVerdict?: "approve" | "revise" | "reject";
    reviewRuntimeUnavailable?: boolean;
    taskClarificationQuestion?: boolean;
  } = {},
): Promise<string> {
  const criticVerdict = options.criticVerdict ?? "approve";
  const reviewRuntimeUnavailable = options.reviewRuntimeUnavailable ?? false;
  const taskClarificationQuestion = options.taskClarificationQuestion ?? false;
  return writeNodeBinary(
    cwd,
    "fake-codex-deep-planning",
    `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!out) {
  process.exit(0);
}
const stringArray = [];
const consensusDraft = {
  summary: "Plan auth around a concrete contract.",
  principles: ["Protect the route before broad polish."],
  decisionDrivers: ["Email/password only", "Protect /dashboard", "No OAuth"],
  viableOptions: [
    { name: "auth-contract-first", rationale: "It binds implementation to the clarified route contract." }
  ],
  selectedOption: {
    name: "auth-contract-first",
    rationale: "It carries the clarified answer into candidate generation."
  },
  rejectedAlternatives: [
    { name: "oauth-generalization", rationale: "OAuth was explicitly excluded." }
  ],
  plannedJudgingCriteria: ["Login succeeds with email/password.", "/dashboard requires authentication."],
  crownGates: ["Do not crown candidates that leave /dashboard unprotected."],
  requiredChangedPaths: [],
  protectedPaths: [],
  workstreams: [
    {
      id: "auth-contract",
      label: "Auth Contract",
      goal: "Add email/password auth and protect /dashboard.",
      targetArtifacts: [],
      requiredChangedPaths: [],
      protectedPaths: [],
      oracleIds: [],
      dependencies: [],
      risks: ["Do not add OAuth."],
      disqualifiers: ["Leaves /dashboard public."]
    }
  ],
  stagePlan: [
    {
      id: "auth-stage",
      label: "Auth Stage",
      dependsOn: [],
      workstreamIds: ["auth-contract"],
      roundIds: ["fast", "impact", "deep"],
      entryCriteria: ["Planning spec is current."],
      exitCriteria: ["/dashboard is protected."]
    }
  ],
  scorecardDefinition: {
    dimensions: ["auth contract fit", "route protection"],
    abstentionTriggers: ["No candidate protects /dashboard."]
  },
  repairPolicy: {
    maxAttemptsPerStage: 1,
    immediateElimination: ["Leaves /dashboard public."],
    repairable: ["Missing focused auth test."],
    preferAbstainOverRetry: ["Auth scope cannot be verified."]
  },
  assumptionLedger: ["Email/password is the only desired auth method."],
  premortem: ["Session or route guard can be incomplete."],
  expandedTestPlan: ["Verify /dashboard redirects when signed out."]
};
const isReportingPrompt = prompt.includes("reporting dashboard");
const latestAnswerMatch = prompt.match(/Latest answer:\\n([^\\n]+)/);
const latestAnswer = latestAnswerMatch ? latestAnswerMatch[1] : "";
const latestAnswerIsUnclear = latestAnswer.includes("still vague");
let body;
if (prompt.includes("selecting the planning depth")) {
  body = prompt.includes("Email/password") || prompt.includes("Latest Augury Interview answer") || isReportingPrompt
    ? {
        interviewDepth: "skip-interview",
        readiness: "ready",
        confidence: "high",
        summary: "The answer resolves the auth scope.",
        reasons: ["Auth method, route, and non-goal are explicit."],
        estimatedInterviewRounds: 0,
        consensusReviewIntensity: "elevated"
      }
    : {
        interviewDepth: "deep-interview",
        readiness: "needs-interview",
        confidence: "high",
        summary: "Auth is too broad without scope.",
        reasons: ["Missing auth method, protected route, and non-goals."],
        estimatedInterviewRounds: 1,
        consensusReviewIntensity: "high"
      };
} else if (prompt.includes("asking the next Augury Interview question")) {
  body = {
    question: "Which auth method, protected route, and non-goals should define success?",
    perspective: "scope-and-success",
    expectedAnswerShape: "Name auth method, route, and excluded auth modes.",
    suggestedAnswers: [
      {
        label: "Email dashboard",
        description: "Use email/password login, protect /dashboard, and exclude OAuth."
      },
      {
        label: "Session dashboard",
        description: "Preserve existing sessions, protect /dashboard, and avoid auth-provider expansion."
      }
    ]
  };
} else if (prompt.includes("scoring whether the latest Augury Interview answer")) {
  body = {
    clarityScore: latestAnswerIsUnclear ? 0.31 : 0.92,
    weakestDimension: latestAnswerIsUnclear ? "success criteria" : "none",
    readyForSpec: !latestAnswerIsUnclear,
    assumptions: latestAnswerIsUnclear ? ["The answer is still too vague."] : ["Email/password is the only desired auth method."],
    ontologySnapshot: {
      goals: latestAnswerIsUnclear ? [] : ["Add email/password authentication and protect /dashboard."],
      constraints: latestAnswerIsUnclear ? [] : ["No OAuth."],
      nonGoals: latestAnswerIsUnclear ? [] : ["Do not add OAuth."],
      acceptanceCriteria: latestAnswerIsUnclear ? [] : ["/dashboard requires authentication."],
      risks: latestAnswerIsUnclear ? [] : ["Avoid broad auth provider scope."]
    }
  };
} else if (prompt.includes("crystallizing an explicit Oraculum Augury Interview")) {
  body = isReportingPrompt
    ? {
        goal: "Build a reporting dashboard.",
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: ["Dashboard renders report data."],
        assumptionsResolved: [],
        assumptionLedger: [],
        repoEvidence: ["Operator requested a reporting dashboard."],
        openRisks: []
      }
    : {
        goal: "Add email/password authentication and protect /dashboard.",
        constraints: ["Email/password only."],
        nonGoals: ["No OAuth."],
        acceptanceCriteria: ["/dashboard requires authentication."],
        assumptionsResolved: prompt.includes("Candidates must prove")
          ? ["Candidates must prove /dashboard redirects signed-out users."]
          : ["Auth method and route are explicit."],
        assumptionLedger: ["Email/password is the only desired auth method."],
        repoEvidence: ["Operator clarified /dashboard as protected route."],
        openRisks: ["Route guard may be incomplete."]
      };
} else if (prompt.includes("drafting a Plan Conclave-reviewed Oraculum consultation plan")) {
  body = consensusDraft;
} else if (prompt.includes("architect reviewer") || prompt.includes("critic reviewer")) {
  if (${JSON.stringify(reviewRuntimeUnavailable)}) {
    body = "review runtime unavailable";
  } else {
    const shouldAskTaskClarification = prompt.includes("critic reviewer") && ${JSON.stringify(taskClarificationQuestion)} && !prompt.includes("Candidates must prove");
    body = {
      verdict: isReportingPrompt
        ? "approve"
        : prompt.includes("critic reviewer")
          ? ${JSON.stringify(criticVerdict)}
          : "approve",
      summary: shouldAskTaskClarification ? "The user-visible success signal is missing." : (!isReportingPrompt && prompt.includes("critic reviewer") && ${JSON.stringify(criticVerdict)} !== "approve" ? "The plan cannot proceed as written." : "The plan is ready."),
      requiredChanges: !isReportingPrompt && prompt.includes("critic reviewer") && ${JSON.stringify(criticVerdict)} !== "approve" ? ["Tighten crown gates before consult."] : stringArray,
      tradeoffs: stringArray,
      risks: stringArray,
      taskClarificationQuestion: shouldAskTaskClarification ? "Which user-visible success signal should candidates prove?" : null
    };
  }
} else {
  body = { decision: "proceed", confidence: "high", summary: "Proceed.", researchPosture: "repo-only", clarificationQuestion: null, researchQuestion: null };
}
fs.writeFileSync(out, JSON.stringify(body), "utf8");
`,
  );
}
