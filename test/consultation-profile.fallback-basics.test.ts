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

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile fallback: baseline signals", () => {
  it("defaults zero-signal fallback detection to the generic profile", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_zero_signals"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_zero_signals" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.candidateCount).toBe(3);
    expect(recommendation.selection.strategyIds).toEqual(["minimal-change", "safety-first"]);
    expect(recommendation.selection.summary).toContain(
      "defaulted to the generic validation posture",
    );
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_zero_signals"), "utf8"),
    ) as { signals: { capabilities: Array<{ kind: string; source: string; value: string }> } };
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "intent",
        source: "fallback-inference",
        value: "unknown",
      }),
    );
  });
  it("uses explicit Make, just, and Taskfile commands during fallback detection without package.json", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep repo checks healthy.\n", "utf8");
    await writeFile(join(cwd, "Makefile"), "lint:\n\t@echo lint\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo test\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_explicit_targets"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_explicit_targets" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_explicit_targets"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ args: string[]; command: string; id: string; pathPolicy?: string }>;
        notes: string[];
      };
    };
    expect(artifact.signals.notes).toContain(
      "No package.json was found; repository facts are limited to files and task context.",
    );
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "make",
          args: ["lint"],
          pathPolicy: "inherit",
        }),
        expect.objectContaining({
          id: "typecheck-fast",
          command: "just",
          args: ["typecheck"],
          pathPolicy: "inherit",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "task",
          args: ["test"],
          pathPolicy: "inherit",
        }),
      ]),
    );
  });
  it("does not let English task keywords choose a profile without repo evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nFrontend React migration schema database UI work.\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_task_keyword_only"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_task_keyword_only" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.signals).toEqual(["unknown"]);
  });
  it("does not let a frontend dependency alone force the frontend profile", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange copy.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "react-only",
          packageManager: "npm@10.0.0",
          dependencies: {
            react: "^19.0.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_react_only"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_react_only" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
  });
  it("keeps workspace-only frontend dependencies as raw facts without semantic frontend shortcuts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange copy.\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-frontend",
          packageManager: "pnpm@10.0.0",
          dependencies: {
            react: "^19.0.0",
            typescript: "^5.8.0",
            vite: "^7.0.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_workspace_frontend_dependency_only"), {
      recursive: true,
    });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_workspace_frontend_dependency_only",
    });

    const artifact = JSON.parse(
      await readFile(
        getProfileSelectionPath(cwd, "run_workspace_frontend_dependency_only"),
        "utf8",
      ),
    ) as {
      signals: {
        capabilities: Array<{
          detail?: string;
          kind: string;
          path?: string;
          source: string;
          value: string;
        }>;
        dependencies: string[];
        notes: string[];
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(artifact.signals.dependencies).toEqual(expect.arrayContaining(["react", "vite"]));
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({
        kind: "build-system",
        value: "frontend-framework",
      }),
    );
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "language",
        value: "typescript",
        source: "workspace-config",
        path: "packages/app/package.json",
        detail: "TypeScript dependency is declared in workspace package metadata.",
      }),
    );
    expect(artifact.signals.notes).toContain(
      "No root package.json was found; repository facts come from workspace manifests, files, and task context.",
    );
  });
  it("detects workspace roots outside the old parent-directory whitelist", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep nested workspace checks healthy.\n",
      "utf8",
    );
    await mkdir(join(cwd, "modules", "app"), { recursive: true });
    await writeFile(
      join(cwd, "modules", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "modules-app",
          packageManager: "pnpm@10.0.0",
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
    await mkdir(getReportsDir(cwd, "run_modules_workspace"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_modules_workspace" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_modules_workspace"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{
          args: string[];
          command: string;
          id: string;
          relativeCwd?: string;
        }>;
        notes: string[];
        workspaceMetadata: Array<{ label: string; manifests: string[]; root: string }>;
        workspaceRoots: string[];
      };
    };

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(artifact.signals.workspaceRoots).toEqual(["modules/app"]);
    expect(artifact.signals.workspaceMetadata).toEqual([
      {
        label: "app",
        manifests: ["modules/app/package.json"],
        root: "modules/app",
      },
    ]);
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: "pnpm",
          args: ["run", "lint"],
          relativeCwd: "modules/app",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: "pnpm",
          args: ["run", "test"],
          relativeCwd: "modules/app",
        }),
      ]),
    );
    expect(artifact.signals.notes).toContain(
      "No root package.json was found; repository facts come from workspace manifests, files, and task context.",
    );
  });
});
