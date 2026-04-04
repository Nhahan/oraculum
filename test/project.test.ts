import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getConfigPath,
  getExportPlanPath,
  getLatestRunStatePath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { projectConfigSchema } from "../src/domain/config.js";
import { exportPlanSchema, latestRunStateSchema, runManifestSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { buildExportPlan, planRun, readLatestRunId } from "../src/services/runs.js";

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
    const fakeCodex = join(cwd, "fake-codex");
    await writeExecutable(
      fakeCodex,
      `#!/bin/sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
cat >/dev/null
if [ -n "$out" ]; then
  printf 'Codex finished candidate patch' > "$out"
fi
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

  it("materializes inline task input and records the latest run pointer", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "fix session loss on refresh",
      candidates: 1,
    });

    expect(manifest.taskPath).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# fix session loss on refresh");

    const latestRunId = await readLatestRunId(cwd);
    expect(latestRunId).toBe(manifest.id);

    const latestRunState = latestRunStateSchema.parse(
      JSON.parse(await readFile(getLatestRunStatePath(cwd), "utf8")) as unknown,
    );
    expect(latestRunState.runId).toBe(manifest.id);
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
    const fakeCodex = join(cwd, "fake-codex");
    await writeExecutable(
      fakeCodex,
      `#!/bin/sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
cat >/dev/null
if [ -n "$out" ]; then
  printf 'Codex finished candidate patch' > "$out"
fi
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
      winnerId: "cand-01",
      branchName: "fix/session-loss",
      withReport: true,
    });

    expect(result.plan.runId).toBe(manifest.id);
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

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}
