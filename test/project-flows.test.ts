import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getPreflightReadinessPath,
  getResearchBriefPath,
  getRunManifestPath,
  getRunsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../src/core/paths.js";
import {
  buildSavedConsultationStatus,
  consultationResearchBriefSchema,
  exportPlanSchema,
  latestRunStateSchema,
  runManifestSchema,
} from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { executeRun } from "../src/services/execution.js";
import { loadProjectConfig } from "../src/services/project.js";
import {
  buildExportPlan,
  planRun,
  readLatestExportableRunId,
  readLatestRunId,
} from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { FAKE_AGENT_TIMEOUT_MS, PROJECT_FLOWS_TEST_TIMEOUT_MS } from "./helpers/integration.js";
import { normalizePathForAssertion } from "./helpers/platform.js";
import {
  createInitializedProject,
  createTempProject,
  registerProjectTempRootCleanup,
} from "./helpers/project.js";

registerProjectTempRootCleanup();

describe("project flows", () => {
  it("plans a run with candidate manifests", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

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
      missingCapabilityCount: 0,
      validationGapCount: 0,
    });
    expect(buildSavedConsultationStatus(saved).nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
    ]);
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
    await mkdir(join(nested, "tasks"), { recursive: true });
    await writeFile(join(nested, "tasks", "fix-session-loss.md"), "# fix nested package\n", "utf8");

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
    await mkdir(join(nested, "tasks"), { recursive: true });
    await writeFile(join(cwd, "tasks", "fix.md"), "# root task\n", "utf8");
    await writeFile(join(nested, "tasks", "fix.md"), "# nested task\n", "utf8");

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
    await writeFile(join(cwd, "tasks", "fix.md"), "# root task\n", "utf8");

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
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    await expect(
      planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        candidates: 17,
      }),
    ).rejects.toThrow("Candidate count must be 16 or less.");
    await expect(readdir(getRunsDir(cwd))).resolves.toEqual([]);
  });

  it(
    "creates an export plan for a selected candidate",
    async () => {
      const cwd = await createInitializedProject();
      await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const manifest = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 2,
      });
      await executeRun({
        cwd,
        runId: manifest.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await buildExportPlan({
        cwd,
        runId: manifest.id,
        winnerId: "cand-01",
        branchName: "manual-sync-label",
        withReport: true,
      });

      const saved = exportPlanSchema.parse(
        JSON.parse(await readFile(getExportPlanPath(cwd, manifest.id), "utf8")) as unknown,
      );

      expect(result.plan.winnerId).toBe("cand-01");
      expect(saved.branchName).toBeUndefined();
      expect(saved.materializationMode).toBe("workspace-sync");
      expect(saved.materializationLabel).toBe("manual-sync-label");
      expect(saved.withReport).toBe(true);
      expect(saved.reportBundle?.files).toEqual(
        expect.arrayContaining([
          getFinalistComparisonJsonPath(cwd, manifest.id),
          getFinalistComparisonMarkdownPath(cwd, manifest.id),
          getWinnerSelectionPath(cwd, manifest.id),
        ]),
      );
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );

  it("rejects export plans for candidates that were not promoted", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('status is "planned"');
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

  it("writes a research brief artifact when preflight requires external research", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
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
    '{"decision":"external-research-required","confidence":"high","summary":"Official versioned API docs are required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the current versioned behavior?"}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    expect(manifest.preflight?.decision).toBe("external-research-required");
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief).toMatchObject({
      decision: "external-research-required",
      confidence: "high",
      researchPosture: "external-research-required",
      question:
        "What does the official API documentation say about the current versioned behavior?",
      task: manifest.taskPacket,
    });
    expect(researchBrief.sources).toEqual([]);
    expect(researchBrief.claims).toEqual([]);
    expect(researchBrief.versionNotes).toEqual([]);
    expect(researchBrief.unresolvedConflicts).toEqual([]);
    expect(researchBrief.conflictHandling).toBe("accepted");
    expect(researchBrief.signalSummary.length).toBeGreaterThan(0);
    expect(researchBrief.signalFingerprint).toBe(
      deriveResearchSignalFingerprint(researchBrief.signalSummary),
    );
  });

  it("accepts a persisted research brief as the next task input", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
          signalFingerprint: deriveResearchSignalFingerprint([
            "Detected explicit lint and test scripts.",
          ]),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(getResearchBriefPath(cwd, "run_research"));
    expect(manifest.taskPacket).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "research-brief",
      sourcePath: getResearchBriefPath(cwd, "run_research"),
      artifactKind: "document",
      targetArtifactPath: "docs/SESSION_PLAN.md",
      researchContext: {
        question:
          "What does the official API documentation say about the current versioned behavior?",
        summary: "Review the official versioned API docs before execution.",
        conflictHandling: "accepted",
        signalSummary: ["Detected explicit lint and test scripts."],
        signalFingerprint: deriveResearchSignalFingerprint([
          "Detected explicit lint and test scripts.",
        ]),
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: [],
      },
      originKind: "task-note",
      originPath: join(cwd, "tasks", "fix-session-loss.md"),
    });
  });

  it("uses repo-plus-external-docs fallback posture when preflighting a persisted research brief without runtime", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight).toMatchObject({
      decision: "proceed",
      confidence: "low",
      researchPosture: "repo-plus-external-docs",
    });
    expect(manifest.preflight?.summary).toContain(
      "Proceed conservatively using the persisted research brief plus repository evidence.",
    );
  });

  it("rejects persisted research briefs whose conflict handling disagrees with unresolved conflicts", () => {
    expect(() =>
      consultationResearchBriefSchema.parse({
        runId: "run_invalid_conflict_handling",
        decision: "external-research-required",
        question: "What does the official API documentation say?",
        confidence: "medium",
        researchPosture: "repo-plus-external-docs",
        summary: "Review the official versioned API docs before execution.",
        task: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
        conflictHandling: "accepted",
        notes: [],
        signalSummary: [],
      }),
    ).toThrow(
      "conflictHandling must match unresolvedConflicts: use manual-review-required when conflicts exist, otherwise accepted.",
    );
  });

  it("records research basis drift when a persisted research brief carries a stale fingerprint", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          signalSummary: ["language:typescript"],
          signalFingerprint: "stale-fingerprint",
          notes: ["Prefer official docs."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight?.decision).toBe("proceed");
    expect(manifest.preflight?.researchBasisDrift).toBe(true);
    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, manifest.id), "utf8"),
    ) as {
      researchBasis?: {
        status?: string;
        refreshAction?: string;
      };
    };
    expect(readiness.researchBasis?.status).toBe("stale");
    expect(readiness.researchBasis?.refreshAction).toBe("refresh-before-rerun");
  });

  it("preserves the original task provenance when a reused research brief still needs external research", async () => {
    const cwd = await createInitializedProject();
    const originalTaskPath = join(cwd, "tasks", "fix-session-loss.md");
    await writeFile(originalTaskPath, "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: originalTaskPath,
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
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
    '{"decision":"external-research-required","confidence":"high","summary":"More official API documentation is required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the newly surfaced edge case?"}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief.task).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "task-note",
      sourcePath: originalTaskPath,
    });
  });

  it("guides missing project config toward host-native init first", async () => {
    const cwd = await createTempProject();

    await expect(loadProjectConfig(cwd)).rejects.toThrow('Run "orc init" after setup');
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
    await mkdir(join(cwd, "reports"), { recursive: true });
    await writeFile(
      join(cwd, "reports", "quality-review.html"),
      "<h1>Quality review</h1>\n<p>Inspect the report.</p>\n",
      "utf8",
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

  it(
    "uses the latest run by default when building an export plan",
    async () => {
      const cwd = await createInitializedProject();
      await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const manifest = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });
      await executeRun({
        cwd,
        runId: manifest.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await buildExportPlan({
        cwd,
        branchName: "fix/session-loss",
        withReport: true,
      });

      expect(result.plan.runId).toBe(manifest.id);
      expect(result.plan.winnerId).toBe("cand-01");
      expect(result.plan.reportBundle?.files).toEqual(
        expect.arrayContaining([
          getFinalistComparisonJsonPath(cwd, manifest.id),
          getFinalistComparisonMarkdownPath(cwd, manifest.id),
        ]),
      );

      const latestRunState = latestRunStateSchema.parse(
        JSON.parse(await readFile(getLatestRunStatePath(cwd), "utf8")) as unknown,
      );
      expect(latestRunState.runId).toBe(manifest.id);

      const latestExportableRunState = latestRunStateSchema.parse(
        JSON.parse(await readFile(getLatestExportableRunStatePath(cwd), "utf8")) as unknown,
      );
      expect(latestExportableRunState.runId).toBe(manifest.id);
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );

  it("rejects implicit export when no recommended survivor exists", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended survivor");
  });

  it("rejects implicit export with artifact-aware wording when the task targets a repo artifact", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_document_without_winner";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "copy",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended document result for docs/SESSION_PLAN.md");
  });

  it("preserves absolute target artifact paths outside the project root in export guidance", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_external_document_without_winner";
    const createdAt = "2026-04-06T00:00:00.000Z";
    const externalTargetArtifactPath = join(tmpdir(), "external", "SESSION_PLAN.md");
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_external_document",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: externalTargetArtifactPath,
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "copy",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      `does not have a recommended document result for ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
  });

  it("accepts implicit export for legacy survivor manifests that only persist outcome survivor ids", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy_survivor";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "legacy-survivor.md"),
          taskPacket: {
            id: "task_legacy_survivor",
            title: "Legacy survivor task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-survivor.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "exported",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01"),
              taskPacketPath: join(cwd, ".oraculum", "tasks", "legacy-survivor.json"),
              workspaceMode: "copy",
              baseSnapshotPath: join(cwd, ".oraculum", "runs", runId, "cand-01-base"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await buildExportPlan({
      cwd,
      runId,
      withReport: false,
    });

    expect(result.plan.runId).toBe(runId);
    expect(result.plan.winnerId).toBe("cand-01");
    expect(result.plan.mode).toBe("workspace-sync");
    expect(result.plan.materializationMode).toBe("workspace-sync");
  });

  it("backfills legacy export aliases from canonical materialization fields", () => {
    const plan = exportPlanSchema.parse({
      runId: "run_alias_only",
      winnerId: "cand-01",
      branchName: "fix/session-loss",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      materializationPatchPath: "/tmp/export.patch",
      withReport: false,
      createdAt: "2026-04-06T00:00:00.000Z",
    });

    expect(plan.mode).toBe("git-branch");
    expect(plan.materializationMode).toBe("branch");
    expect(plan.patchPath).toBe("/tmp/export.patch");
    expect(plan.materializationPatchPath).toBe("/tmp/export.patch");
  });

  it(
    "keeps the latest exportable run when a later run is only planned",
    async () => {
      const cwd = await createInitializedProject();
      await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const completedRun = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });
      await executeRun({
        cwd,
        runId: completedRun.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        candidates: 1,
      });

      const result = await buildExportPlan({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      expect(result.plan.runId).toBe(completedRun.id);
      expect(await readLatestExportableRunId(cwd)).toBe(completedRun.id);
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );

  it("rejects older exportable runs that do not record base metadata", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "legacy-task.md"),
          taskPacket: {
            id: "task_legacy",
            title: "Legacy task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-task.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
            {
              id: "impact",
              label: "Impact",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
            {
              id: "deep",
              label: "Deep",
              status: "completed",
              verdictCount: 0,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "fallback-policy",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "workspaces", runId, "cand-01"),
              taskPacketPath: join(
                cwd,
                ".oraculum",
                "runs",
                runId,
                "candidates",
                "cand-01",
                "task-packet.json",
              ),
              workspaceMode: "git-worktree",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getLatestExportableRunStatePath(cwd),
      `${JSON.stringify({ runId, updatedAt: createdAt }, null, 2)}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("git base revision needed for branch materialization");
  });

  it("requires a branch name when materializing a branch-backed recommended result", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_branch_materialization";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "branch-backed.md"),
          taskPacket: {
            id: "task_branch",
            title: "Branch-backed task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "branch-backed.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "llm-judge",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "git-worktree",
              baseRevision: "abc123",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("Branch materialization requires a target branch name");
  });

  it("uses artifact-aware guidance when a recommended result lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_missing_materialization_mode";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document_mode",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "llm-judge",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-01" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
  });

  it("uses selected-finalist guidance when an explicit crown target lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_selected_finalist_missing_materialization_mode";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document_selected_mode",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-02",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-02", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-02", "task-packet.json"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        winnerId: "cand-02",
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-02" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
  });
});
