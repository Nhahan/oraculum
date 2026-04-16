import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getProfileSelectionPath, getReportsDir } from "../src/core/paths.js";
import { initializeProject } from "../src/services/project.js";
import {
  createTempRoot,
  recommendFallbackProfile,
  registerConsultationProfileTempRootCleanup,
} from "./helpers/consultation-profile.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile fallback: command surfaces", () => {
  it("deduplicates aliased expensive package scripts under a single command candidate", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep tests stable.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "duplicate-test-aliases",
          packageManager: "npm@10.0.0",
          scripts: {
            test: 'node -e "process.exit(0)"',
            "test:full": 'node -e "process.exit(0)"',
            verify: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_duplicate_aliases"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_duplicate_aliases" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_duplicate_aliases"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ args: string[]; dedupeKey?: string; id: string }>;
        skippedCommandCandidates: Array<{ reason: string }>;
      };
    };
    const fullSuiteCommands = artifact.signals.commandCatalog.filter(
      (command) => command.id === "full-suite-deep",
    );
    expect(fullSuiteCommands).toHaveLength(1);
    expect(fullSuiteCommands[0]?.args).toEqual(["run", "test"]);
    expect(fullSuiteCommands[0]?.dedupeKey).toBe('package-script:node -e "process.exit(0)"');
    expect(artifact.signals.skippedCommandCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "duplicate-expensive-command" })]),
    );
  });
  it("deduplicates duplicate expensive script bodies under different command labels", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep tests stable.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "duplicate-test-bodies",
          packageManager: "npm@10.0.0",
          scripts: {
            unit: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_duplicate_bodies"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_duplicate_bodies" });

    const testOracles = recommendation.config.oracles.filter(
      (oracle) =>
        oracle.command === "npm" &&
        (oracle.args.join(" ") === "run unit" || oracle.args.join(" ") === "run test"),
    );
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toContain("unit-impact");
    expect(recommendation.selection.oracleIds).not.toContain("full-suite-deep");
    expect(recommendation.selection.missingCapabilities).toEqual([]);
    expect(testOracles).toHaveLength(1);
  });
  it("records nested workspace signals without inventing root-level commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep nested package healthy.\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "nested-app",
          scripts: {
            test: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "packages", "app", "tsconfig.json"), "{}\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_nested_workspace"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_nested_workspace" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_workspace"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; source: string; value: string }>;
        workspaceMetadata: Array<{ label: string; manifests: string[]; root: string }>;
        workspaceRoots: string[];
      };
    };
    expect(artifact.signals.workspaceRoots).toEqual(["packages/app"]);
    expect(artifact.signals.workspaceMetadata).toEqual([
      {
        label: "app",
        manifests: ["packages/app/package.json"],
        root: "packages/app",
      },
    ]);
    expect(artifact.signals.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "language",
          source: "workspace-config",
          value: "javascript",
        }),
        expect.objectContaining({
          kind: "language",
          path: "packages/app/tsconfig.json",
          source: "workspace-config",
          value: "typescript",
        }),
        expect.objectContaining({
          kind: "build-system",
          source: "workspace-config",
          value: "workspace",
        }),
      ]),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
    expect(recommendation.selection.profileId).toBe("generic");
  });
  it("uses an unambiguous workspace package script as executable evidence with a relative cwd", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep workspace checks healthy.\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-root",
          packageManager: "pnpm@10.0.0",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "nested-app",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_workspace_scripts"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_workspace_scripts" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_scripts"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{
          args: string[];
          command: string;
          id: string;
          relativeCwd?: string;
        }>;
        notes: string[];
      };
    };

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.config.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "pnpm",
          args: ["run", "lint"],
          relativeCwd: "packages/app",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "pnpm",
          args: ["run", "test"],
          relativeCwd: "packages/app",
        }),
      ]),
    );
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "pnpm",
          args: ["run", "lint"],
          relativeCwd: "packages/app",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "pnpm",
          args: ["run", "test"],
          relativeCwd: "packages/app",
        }),
      ]),
    );
    expect(artifact.signals.notes).not.toContain(
      "No package.json was found; repository facts are limited to files and task context.",
    );
  });
  it("uses an unambiguous workspace-local entrypoint as executable evidence with a relative cwd", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep workspace entrypoints healthy.\n",
      "utf8",
    );
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", "pyproject.toml"), "[project]\nname='app'\n");
    await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
    await mkdir(join(cwd, "packages", "app", "scripts"), { recursive: true });
    await writeNodeBinary(
      join(cwd, "packages", "app", "bin"),
      "lint",
      'process.stdout.write("lint\\n");',
    );
    await writeNodeBinary(
      join(cwd, "packages", "app", "scripts"),
      "test",
      'process.stdout.write("test\\n");',
    );
    await mkdir(getReportsDir(cwd, "run_workspace_entrypoints"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_workspace_entrypoints",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_entrypoints"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{
          command: string;
          id: string;
          pathPolicy?: string;
          provenance?: { path?: string; source: string };
          relativeCwd?: string;
        }>;
        notes: string[];
      };
    };

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.config.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "bin/lint",
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "scripts/test",
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
      ]),
    );
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "bin/lint",
          relativeCwd: "packages/app",
          provenance: expect.objectContaining({
            path: "packages/app/bin/lint",
            source: "local-tool",
          }),
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "scripts/test",
          relativeCwd: "packages/app",
          provenance: expect.objectContaining({
            path: "packages/app/scripts/test",
            source: "local-tool",
          }),
        }),
      ]),
    );
    expect(artifact.signals.notes).toContain(
      "No package.json was found; repository facts are limited to files and task context.",
    );
  });
  it("uses nested workspace config files as profile signals without inventing root-level commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep nested frontend healthy.\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify({ name: "nested-frontend" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "packages", "app", "vite.config.ts"), "export default {};\n", "utf8");
    await writeFile(
      join(cwd, "packages", "app", "playwright.config.ts"),
      "export default {};\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_nested_frontend"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_nested_frontend" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_frontend"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({ kind: "intent", value: "frontend" }),
    );
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "test-runner",
        path: "packages/app/playwright.config.ts",
        source: "workspace-config",
        value: "playwright",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "packages/app/playwright.config.ts",
        signal: "test-runner:playwright",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "packages/app/vite.config.ts",
        signal: "build-system:frontend-config",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
  });
  it("records ambiguous root-local entrypoints instead of inventing a root command", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep linting honest.\n", "utf8");
    await mkdir(join(cwd, "bin"), { recursive: true });
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "bin"), "lint", 'process.stdout.write("bin\\n");');
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("scripts\\n");');
    await mkdir(getReportsDir(cwd, "run_ambiguous_root_entrypoint"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_ambiguous_root_entrypoint",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_ambiguous_root_entrypoint"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ id: string }>;
        skippedCommandCandidates: Array<{
          id: string;
          provenance?: { signal: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(recommendation.selection.oracleIds).not.toContain("lint-fast");
    expect(artifact.signals.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lint-fast" })]),
    );
    expect(artifact.signals.skippedCommandCandidates).toContainEqual(
      expect.objectContaining({
        id: "lint-fast",
        reason: "ambiguous-local-command",
        provenance: expect.objectContaining({
          signal: "root-entrypoint:lint",
          source: "local-tool",
        }),
      }),
    );
  });
  it("records ambiguous explicit command surfaces instead of inventing collector precedence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await writeFile(join(cwd, "Makefile"), "test:\n\t@echo make-test\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo task-test\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_ambiguous_explicit_collectors"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_ambiguous_explicit_collectors",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_ambiguous_explicit_collectors"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ id: string }>;
        skippedCommandCandidates: Array<{
          detail: string;
          id: string;
          reason: string;
        }>;
      };
    };

    expect(recommendation.selection.oracleIds).not.toContain("full-suite-deep");
    expect(artifact.signals.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "full-suite-deep" })]),
    );
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "typecheck-fast" })]),
    );
    expect(artifact.signals.skippedCommandCandidates).toContainEqual(
      expect.objectContaining({
        id: "full-suite-deep",
        reason: "ambiguous-explicit-command",
        detail: expect.stringContaining("Makefile"),
      }),
    );
  });
});
