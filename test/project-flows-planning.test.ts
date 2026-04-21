import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getConsultationPlanPath,
  getPreflightReadinessPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../src/core/paths.js";
import {
  buildSavedConsultationStatus,
  consultationPlanArtifactSchema,
  runManifestSchema,
} from "../src/domain/run.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";
import { loadProjectConfig } from "../src/services/project.js";
import { planRun, readLatestExportableRunId, readLatestRunId } from "../src/services/runs.js";
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

    const manifest = await planRun({
      cwd,
      taskInput: "add authentication",
      candidates: 1,
      requirePlanningClarification: true,
      writeConsultationPlanArtifacts: true,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.status).toBe("completed");
    expect(manifest.candidateCount).toBe(0);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.preflight).toMatchObject({
      decision: "needs-clarification",
      clarificationQuestion:
        "Which auth or session flow should the plan target, what concrete behavior should change, and what is out of scope?",
    });

    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(getConsultationPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(planArtifact.readyForConsult).toBe(false);
    expect(planArtifact.openQuestions).toContain(
      "Which auth or session flow should the plan target, what concrete behavior should change, and what is out of scope?",
    );
    expect(planArtifact.recommendedNextAction).toContain("orc plan <task> --answer");

    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, manifest.id), "utf8"),
    ) as {
      recommendation?: { decision?: string; clarificationQuestion?: string };
    };
    expect(readiness.recommendation).toMatchObject({
      decision: "needs-clarification",
      clarificationQuestion:
        "Which auth or session flow should the plan target, what concrete behavior should change, and what is out of scope?",
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
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.status).toBe("planned");
    expect(manifest.candidateCount).toBe(1);
    expect(manifest.preflight?.decision).toBe("proceed");

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

  it("guides missing project config toward init after setup", async () => {
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
