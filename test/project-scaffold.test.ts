import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getAdvancedConfigPath, getConfigPath } from "../src/core/paths.js";
import {
  projectAdvancedConfigSchema,
  projectConfigSchema,
  projectQuickConfigSchema,
} from "../src/domain/config.js";
import {
  ensureProjectInitialized,
  initializeProject,
  loadProjectConfig,
} from "../src/services/project.js";
import {
  createInitializedProject,
  createTempProject,
  registerProjectTempRootCleanup,
} from "./helpers/project.js";

registerProjectTempRootCleanup();

describe("project scaffold", () => {
  it("initializes the default config and directories", async () => {
    const cwd = await createTempProject();

    const result = await initializeProject({ cwd, force: false });
    const configPath = getConfigPath(cwd);
    const configRaw = await readFile(configPath, "utf8");

    expect(result.configPath).toBe(configPath);
    expect(result.createdPaths).toHaveLength(4);
    expect(projectQuickConfigSchema.parse(JSON.parse(configRaw) as unknown).defaultAgent).toBe(
      "claude-code",
    );
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("merges quick-start and advanced settings into the runtime config", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 2,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          judge: {
            secondOpinion: {
              enabled: true,
              adapter: "claude-code",
              triggers: ["judge-abstain", "many-changed-paths"],
              minChangedPaths: 2,
              minChangedLines: 120,
            },
          },
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(config.defaultAgent).toBe("codex");
    expect(config.defaultCandidates).toBe(2);
    expect(config.rounds).toHaveLength(3);
    expect(config.strategies).toHaveLength(4);
    expect(config.oracles[0]?.id).toBe("lint-fast");
    expect(config.judge.secondOpinion).toMatchObject({
      enabled: true,
      adapter: "claude-code",
      triggers: ["judge-abstain", "many-changed-paths"],
      minChangedPaths: 2,
      minChangedLines: 120,
    });
    expect(
      projectAdvancedConfigSchema.parse(
        JSON.parse(await readFile(getAdvancedConfigPath(cwd), "utf8")) as unknown,
      ).oracles?.[0]?.id,
    ).toBe("lint-fast");
  });

  it("rejects advanced-only fields in the quick-start config", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow();
  });

  it("accepts the older full config shape for backward compatibility", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 3,
          adapters: ["claude-code", "codex"],
          strategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
              description: "Keep the diff small.",
            },
          ],
          rounds: [
            {
              id: "fast",
              label: "Fast",
              description: "Quick checks.",
            },
          ],
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(projectConfigSchema.parse(config).defaultAgent).toBe("codex");
    expect(config.rounds).toHaveLength(1);
    expect(config.oracles[0]?.id).toBe("lint-fast");
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("applies advanced overrides on top of the older full config shape", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 3,
          adapters: ["claude-code", "codex"],
          strategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
              description: "Keep the diff small.",
            },
          ],
          rounds: [
            {
              id: "fast",
              label: "Fast",
              description: "Quick checks.",
            },
          ],
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "impact-review",
              roundId: "impact",
              command: "npm",
              args: ["run", "test"],
              invariant: "The candidate must pass impacted review checks.",
              enforcement: "signal",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(config.defaultAgent).toBe("codex");
    expect(config.rounds).toHaveLength(1);
    expect(config.oracles).toHaveLength(1);
    expect(config.oracles[0]?.id).toBe("impact-review");
    expect(config.oracles[0]?.roundId).toBe("impact");
  });

  it("removes stale advanced settings when force init resets the project", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await initializeProject({ cwd, force: true });

    const config = await loadProjectConfig(cwd);
    expect(config.oracles).toHaveLength(0);
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("preserves valid advanced settings during auto-init when quick config is missing", async () => {
    const cwd = await createTempProject();
    await mkdir(join(cwd, ".oraculum"), { recursive: true });
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await ensureProjectInitialized(cwd);

    const config = await loadProjectConfig(cwd);
    expect(config.oracles).toHaveLength(1);
    expect(config.oracles[0]?.id).toBe("lint-fast");
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).resolves.toContain('"lint-fast"');
  });
});
