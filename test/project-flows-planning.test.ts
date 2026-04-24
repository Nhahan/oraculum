import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
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
import { planRun, readLatestExportableRunId, readLatestRunId } from "../src/services/runs.js";
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
    expect(planArtifact.recommendedNextAction).toContain('orc plan "<task plus the answer>"');
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
    expect(readiness).toMatchObject({
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Which auth method, protected route, and non-goals should define success?",
      ],
    });
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
  });

  it("connects an explicit planning answer to the active interview and writes consensus artifacts", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd);

    await planRun({
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
        type: "needs-clarification",
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
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Consensus review did not approve before the revision cap; revise the task contract or rerun planning.",
      ],
    });
  });

  it("treats Plan Conclave reviewer rejection as terminal without revision", async () => {
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
    const status = buildSavedConsultationStatus(manifest, {
      planConclaveRemediationRecommended: true,
    });

    expect(manifest).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "needs-clarification",
      },
      preflight: {
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
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Plan Conclave rejected the draft; address the review finding and rerun planning.",
      ],
    });
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "review-preflight-readiness",
      "answer-plan-conclave-and-rerun",
    ]);
    expect(summary).toContain("Plan Conclave remediation needed:");
    expect(summary).toContain("Plan Conclave blocker: rejected");
    expect(summary).toContain("Tighten crown gates before consult.");
    expect(review.recommendationAbsenceReason).toContain("Plan Conclave remediation is required");
    expect(review.artifactAvailability.planConsensus).toBe(true);
  });

  it("continues a rejected Plan Conclave with a remediation answer in a new run", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
      approveRemediation: true,
    });

    const blocked = await planRun({
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
    const originalConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, blocked.id), "utf8")) as unknown,
    );

    const continued = await planRun({
      cwd,
      taskInput:
        "Tighten crown gates by requiring candidate evidence that /dashboard redirects when signed out.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const continuedConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, continued.id), "utf8")) as unknown,
    );
    const continuedSpec = planningSpecArtifactSchema.parse(
      JSON.parse(await readFile(getPlanningSpecPath(cwd, continued.id), "utf8")) as unknown,
    );
    const rereadOriginalConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, blocked.id), "utf8")) as unknown,
    );

    expect(blocked.id).not.toBe(continued.id);
    expect(originalConsensus.continuation).toBeUndefined();
    expect(rereadOriginalConsensus.continuation).toBeUndefined();
    expect(continued.status).toBe("planned");
    expect(continued.candidates).toHaveLength(4);
    expect(continued.taskPath).toBe(blocked.taskPath);
    expect(continued.taskPacket.sourcePath).toBe(blocked.taskPacket.sourcePath);
    expect(continued.taskPacket.title).toBe(blocked.taskPacket.title);
    expect(continued.taskPacket.id).toBe(blocked.taskPacket.id);
    expect(continued.taskPacket.targetArtifactPath).toBe(blocked.taskPacket.targetArtifactPath);
    expect(continued.taskPacket.artifactKind).toBe(blocked.taskPacket.artifactKind);
    expect(continuedConsensus).toMatchObject({
      approved: true,
      continuation: {
        sourceRunId: blocked.id,
        sourceConsensusRunId: blocked.id,
        blockerKind: "rejected",
        requiredChanges: ["Tighten crown gates before consult."],
      },
    });
    expect(continuedConsensus.continuation?.answer).toContain("Tighten crown gates");
    expect(continuedSpec.assumptionsResolved).toContainEqual(
      expect.stringContaining("Plan Conclave remediation answer"),
    );
  });

  it("continues Plan Conclave remediation from the persisted source task if the task file changes", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
      approveRemediation: true,
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

    const continued = await planRun({
      cwd,
      taskInput:
        "Tighten crown gates by requiring candidate evidence that /dashboard redirects when signed out.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
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
    const continuedConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, continued.id), "utf8")) as unknown,
    );

    expect(blockedPlan.task.title).toBe("Auth plan");
    expect(continued.status).toBe("planned");
    expect(continued.taskPath).toBe(blocked.taskPath);
    expect(continued.taskPacket.title).toBe("Auth plan");
    expect(continuedPlan.task.title).toBe("Auth plan");
    expect(continuedPlan.task.intent).toContain("Email/password");
    expect(continuedPlan.task.intent).toContain("Plan Conclave remediation answer");
    expect(continuedPlan.task.intent).not.toContain("weekly metrics");
    expect(continuedConsensus.continuation?.sourceRunId).toBe(blocked.id);
  });

  it("starts a normal planning run when a stale Plan Conclave target cannot load its source task", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
      approveRemediation: true,
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
    await unlink(getConsultationPlanPath(cwd, blocked.id));
    await unlink(blocked.taskPath);
    const blockedSummary = await renderConsultationSummary(blocked, cwd);

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

    expect(blockedSummary).toContain("Plan Conclave remediation needed:");
    expect(blockedSummary).toContain("Tighten crown gates before consult.");
    expect(newTask.status).toBe("planned");
    expect(newTask.taskPacket.title).toBe("Build a reporting dashboard for weekly metrics");
    expect(consensus.continuation).toBeUndefined();
  });

  it("ignores stale Plan Conclave artifacts whose runId does not match the run directory", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
      approveRemediation: true,
    });

    const blocked = await planRun({
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
    const staleConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, blocked.id), "utf8")) as unknown,
    );
    await writeFile(
      getPlanConsensusPath(cwd, blocked.id),
      `${JSON.stringify({ ...staleConsensus, runId: "run_stale_consensus" })}\n`,
      "utf8",
    );

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
    expect(newTask.taskPacket.title).toBe("Build a reporting dashboard for weekly metrics");
    expect(consensus.continuation).toBeUndefined();
  });

  it("keeps failed Plan Conclave remediation as a new blocked run with source metadata", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
      approveRemediation: false,
    });

    const blocked = await planRun({
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
    const continued = await planRun({
      cwd,
      taskInput: "Tighten crown gates but leave the blocker unresolved.",
      agent: "codex",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: true,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const continuedConsensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, continued.id), "utf8")) as unknown,
    );

    expect(continued).toMatchObject({
      status: "completed",
      candidateCount: 0,
      candidates: [],
      outcome: {
        type: "needs-clarification",
      },
    });
    expect(continuedConsensus).toMatchObject({
      approved: false,
      continuation: {
        sourceRunId: blocked.id,
        blockerKind: "rejected",
      },
    });
  });

  it("starts a normal planning run when input is a new task instead of Plan Conclave remediation", async () => {
    const cwd = await createInitializedProject();
    const fakeCodex = await createDeepPlanningCodexBinary(cwd, {
      criticVerdict: "reject",
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
    expect(consensus.continuation).toBeUndefined();
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
        type: "needs-clarification",
      },
      preflight: {
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
      status: "needs-clarification",
      readyForConsult: false,
      unresolvedQuestions: [
        "Plan Conclave review runtime unavailable. Rerun planning when architect/critic review can execute.",
      ],
    });
  });

  it("does not treat runtime-unavailable Plan Conclave blockers as remediation targets", async () => {
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

    const consensus = planConsensusArtifactSchema.parse(
      JSON.parse(await readFile(getPlanConsensusPath(cwd, rerun.id), "utf8")) as unknown,
    );

    expect(consensus.continuation).toBeUndefined();
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
    approveRemediation?: boolean;
    criticVerdict?: "approve" | "revise" | "reject";
    reviewRuntimeUnavailable?: boolean;
  } = {},
): Promise<string> {
  const approveRemediation = options.approveRemediation ?? true;
  const criticVerdict = options.criticVerdict ?? "approve";
  const reviewRuntimeUnavailable = options.reviewRuntimeUnavailable ?? false;
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
const isRemediationPrompt = prompt.includes("Plan Conclave remediation answer");
const isReportingPrompt = prompt.includes("reporting dashboard");
let body;
if (prompt.includes("selecting the planning depth")) {
  body = prompt.includes("Email/password") || isReportingPrompt
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
} else if (prompt.includes("remediation answer for a blocked Oraculum Plan Conclave")) {
  body = {
    classification: isReportingPrompt ? "new-task" : "consensus-remediation",
    confidence: "high",
    summary: isReportingPrompt
      ? "The input starts a new reporting task."
      : "The input directly answers the Plan Conclave required changes."
  };
} else if (prompt.includes("answer or refinement for the active interview")) {
  body = {
    classification: "continuation",
    confidence: "high",
    summary: "The input answers the active auth clarification."
  };
} else if (prompt.includes("asking the next Augury Interview question")) {
  body = {
    question: "Which auth method, protected route, and non-goals should define success?",
    perspective: "scope-and-success",
    expectedAnswerShape: "Name auth method, route, and excluded auth modes."
  };
} else if (prompt.includes("scoring whether the latest Augury Interview answer")) {
  body = {
    clarityScore: 0.92,
    weakestDimension: "none",
    readyForSpec: true,
    assumptions: ["Email/password is the only desired auth method."],
    ontologySnapshot: {
      goals: ["Add email/password authentication and protect /dashboard."],
      constraints: ["No OAuth."],
      nonGoals: ["Do not add OAuth."],
      acceptanceCriteria: ["/dashboard requires authentication."],
      risks: ["Avoid broad auth provider scope."]
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
        assumptionsResolved: ["Auth method and route are explicit."],
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
    body = {
      verdict: isReportingPrompt || (isRemediationPrompt && ${JSON.stringify(approveRemediation)})
        ? "approve"
        : prompt.includes("critic reviewer")
          ? ${JSON.stringify(criticVerdict)}
          : "approve",
      summary: !isReportingPrompt && !isRemediationPrompt && prompt.includes("critic reviewer") && ${JSON.stringify(criticVerdict)} !== "approve" ? "The plan cannot proceed as written." : "The plan is ready.",
      requiredChanges: !isReportingPrompt && !isRemediationPrompt && prompt.includes("critic reviewer") && ${JSON.stringify(criticVerdict)} !== "approve" ? ["Tighten crown gates before consult."] : stringArray,
      tradeoffs: stringArray,
      risks: stringArray
    };
  }
} else {
  body = { decision: "proceed", confidence: "high", summary: "Proceed.", researchPosture: "repo-only", clarificationQuestion: null, researchQuestion: null };
}
fs.writeFileSync(out, JSON.stringify(body), "utf8");
`,
  );
}
