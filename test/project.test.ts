import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getConfigPath, getExportPlanPath, getRunManifestPath } from "../src/core/paths.js";
import { projectConfigSchema } from "../src/domain/config.js";
import { exportPlanSchema, runManifestSchema } from "../src/domain/run.js";
import { initializeProject } from "../src/services/project.js";
import { buildExportPlan, planRun } from "../src/services/runs.js";

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
    expect(result.createdPaths).toHaveLength(3);
    expect(projectConfigSchema.parse(JSON.parse(configRaw) as unknown).defaultAgent).toBe(
      "claude-code",
    );
  });

  it("plans a run with candidate manifests", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskPath: "tasks/fix-session-loss.md",
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

    const manifest = await planRun({
      cwd,
      taskPath: "tasks/fix-session-loss.md",
      candidates: 2,
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
