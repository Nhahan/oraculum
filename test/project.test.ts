import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getConfigPath,
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getRunManifestPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { projectConfigSchema } from "../src/domain/config.js";
import { exportPlanSchema, latestRunStateSchema, runManifestSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import {
  buildExportPlan,
  planRun,
  readLatestExportableRunId,
  readLatestRunId,
} from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("project scaffold", () => {
  it("initializes the default config and directories", async () => {
    const cwd = await createTempProject();

    const result = await initializeProject({ cwd, force: false });
    const configPath = getConfigPath(cwd);
    const configRaw = await readFile(configPath, "utf8");

    expect(result.configPath).toBe(configPath);
    expect(result.createdPaths).toHaveLength(4);
    expect(projectConfigSchema.parse(JSON.parse(configRaw) as unknown).defaultAgent).toBe(
      "claude-code",
    );
  });

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
  });

  it("creates an export plan for a selected candidate", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended winner."}'
    : "Codex finished candidate patch";
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
      timeoutMs: 5_000,
    });

    const result = await buildExportPlan({
      cwd,
      runId: manifest.id,
      winnerId: "cand-01",
      branchName: "fix/session-loss",
      withReport: true,
    });

    const saved = exportPlanSchema.parse(
      JSON.parse(await readFile(getExportPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );

    expect(result.plan.winnerId).toBe("cand-01");
    expect(saved.branchName).toBe("fix/session-loss");
    expect(saved.withReport).toBe(true);
    expect(saved.reportBundle?.files).toEqual(
      expect.arrayContaining([
        getFinalistComparisonJsonPath(cwd, manifest.id),
        getFinalistComparisonMarkdownPath(cwd, manifest.id),
        getWinnerSelectionPath(cwd, manifest.id),
      ]),
    );
  });

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
      taskInput: "fix session loss on refresh",
      candidates: 1,
    });

    expect(manifest.taskPath).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# fix session loss on refresh");
    await expect(readLatestRunId(cwd)).rejects.toThrow("No previous run found");
    await expect(readLatestExportableRunId(cwd)).rejects.toThrow("No exportable run found yet");
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

  it("uses the latest run by default when building an export plan", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended winner."}'
    : "Codex finished candidate patch";
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
      timeoutMs: 5_000,
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
  });

  it("rejects implicit export when no recommended winner exists", async () => {
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
    ).rejects.toThrow("does not have a recommended winner");
  });

  it("keeps the latest exportable run when a later run is only planned", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended winner."}'
    : "Codex finished candidate patch";
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
      timeoutMs: 5_000,
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
  });

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
            summary: "cand-01 is the recommended winner.",
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
    ).rejects.toThrow("older run artifact");
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await createTempProject();
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function createTempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}
