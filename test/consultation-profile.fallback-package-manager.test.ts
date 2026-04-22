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

describe("consultation auto profile fallback: package managers and migrations", () => {
  it("uses nested workspace files as raw facts without inventing unsafe commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep nested database migration healthy.\n",
      "utf8",
    );
    await mkdir(join(cwd, "services", "api"), { recursive: true });
    await writeFile(join(cwd, "services", "api", "pyproject.toml"), "[project]\nname='api'\n");
    await writeFile(join(cwd, "services", "api", "alembic.ini"), "[alembic]\n");
    await mkdir(getReportsDir(cwd, "run_nested_migration"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_nested_migration" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_migration"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        files: string[];
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({ kind: "intent", value: "migration" }),
    );
    expect(artifact.signals.files).toContain("services/api/alembic.ini");
    expect(artifact.signals.commandCatalog).toEqual([]);
  });
  it("keeps migration-shaped config files as raw facts without inventing unsafe commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nReview the migration config.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "drizzle-service",
          packageManager: "pnpm@9.0.0",
          dependencies: {
            "drizzle-kit": "^0.31.0",
            "drizzle-orm": "^0.42.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "drizzle.config.ts"), "export default {};\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_drizzle_migration"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_drizzle_migration" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_drizzle_migration"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        commandCatalog: Array<{ command: string }>;
        dependencies: string[];
        files: string[];
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(artifact.signals.dependencies).toEqual(
      expect.arrayContaining(["drizzle-kit", "drizzle-orm"]),
    );
    expect(artifact.signals.files).toContain("drizzle.config.ts");
    expect(artifact.signals.commandCatalog).toEqual([]);
  });
  it("keeps dependency-only migration packages as raw dependencies without semantic migration shortcuts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nReview the database migration.\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "knex-service",
          packageManager: "npm@10.0.0",
          dependencies: {
            knex: "^3.1.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_knex_migration"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_knex_migration" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_knex_migration"), "utf8"),
    ) as {
      signals: {
        dependencies: string[];
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        commandCatalog: Array<{ command: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(artifact.signals.dependencies).toEqual(expect.arrayContaining(["knex"]));
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({
        kind: "migration-tool",
        value: "knex",
      }),
    );
    expect(artifact.signals.provenance).not.toContainEqual(
      expect.objectContaining({
        signal: "migration-tool:knex",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
  });
  it("records lockfile-only package manager signals without claiming package metadata", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await writeFile(join(cwd, "package-lock.json"), "{}\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_lockfile_only"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_lockfile_only" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_lockfile_only"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{
          detail?: string;
          kind: string;
          path?: string;
          source: string;
          value: string;
        }>;
        notes: string[];
      };
    };
    const packageManagerCapability = artifact.signals.capabilities.find(
      (capability) => capability.kind === "build-system" && capability.value === "npm",
    );
    expect(packageManagerCapability).toEqual(
      expect.objectContaining({
        detail: "Package manager detected from a lockfile.",
        source: "root-config",
      }),
    );
    expect(packageManagerCapability?.path).toBeUndefined();
    expect(artifact.signals.notes).toContain(
      "No package.json was found; repository facts are limited to files and task context.",
    );
  });
  it("records workspace package-manager signals when only a workspace manifest declares them", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          type: "module",
          packageManager: "pnpm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_workspace_package_manager"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_workspace_package_manager" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_package_manager"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{
          detail?: string;
          kind: string;
          path?: string;
          source: string;
          value: string;
        }>;
        commandCatalog: Array<{ id: string; relativeCwd?: string }>;
        notes: string[];
      };
    };
    const packageManagerCapability = artifact.signals.capabilities.find(
      (capability) => capability.kind === "build-system" && capability.value === "pnpm",
    );
    expect(packageManagerCapability).toEqual(
      expect.objectContaining({
        detail: "Package manager detected from workspace package metadata.",
        path: "packages/app/package.json",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          relativeCwd: "packages/app",
        }),
      ]),
    );
    expect(artifact.signals.notes).not.toContain(
      "No unambiguous lockfile or packageManager metadata was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
    expect(artifact.signals.notes).toContain(
      "No root package.json was found; repository facts come from workspace manifests, files, and task context.",
    );
  });
  it("continues profile fallback when the root package manifest is invalid", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await writeFile(join(cwd, "package.json"), "{\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          packageManager: "pnpm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_invalid_root_package_json"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_invalid_root_package_json" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_invalid_root_package_json"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ id: string; relativeCwd?: string }>;
        notes: string[];
      };
    };
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          relativeCwd: "packages/app",
        }),
      ]),
    );
    expect(artifact.signals.notes).toContain(
      "Skipped invalid package.json manifest: package.json.",
    );
    expect(artifact.signals.notes).toContain(
      "Root package.json is invalid; repository facts come from valid workspace manifests, files, and task context.",
    );
  });
  it("does not invent npm script commands when the package manager is unknown", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "ambiguous-package-manager",
          type: "module",
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
    await mkdir(getReportsDir(cwd, "run_unknown_package_manager"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_unknown_package_manager" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_unknown_package_manager"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        notes: string[];
        skippedCommandCandidates: Array<{
          id: string;
          provenance?: { path?: string; signal: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(artifact.signals.commandCatalog).toEqual([]);
    expect(artifact.signals.notes).toContain(
      "No unambiguous lockfile or packageManager metadata was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-package-manager",
          provenance: expect.objectContaining({
            path: "package.json",
            signal: "script:lint",
            source: "root-config",
          }),
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          reason: "ambiguous-package-manager",
        }),
      ]),
    );
  });
  it("records workspace package-script ambiguity when no package manager is detected", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep checks honest.\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          type: "module",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_unknown_workspace_package_manager"), { recursive: true });

    await recommendFallbackProfile({ cwd, runId: "run_unknown_workspace_package_manager" });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_unknown_workspace_package_manager"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        notes: string[];
        skippedCommandCandidates: Array<{
          id: string;
          provenance?: { path?: string; signal: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(artifact.signals.commandCatalog).toEqual([]);
    expect(artifact.signals.notes).toContain(
      "No unambiguous lockfile or packageManager metadata was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
    expect(artifact.signals.notes).toContain(
      "No root package.json was found; repository facts come from workspace manifests, files, and task context.",
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-package-manager",
          provenance: expect.objectContaining({
            path: "packages/app/package.json",
            signal: "script:lint",
            source: "workspace-config",
          }),
        }),
      ]),
    );
  });
  it("does not use npm pack smoke checks for non-npm package managers", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep package exports healthy.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "pnpm-library",
          packageManager: "pnpm@9.0.0",
          type: "module",
          exports: "./dist/index.js",
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
    await mkdir(getReportsDir(cwd, "run_pnpm_library"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_pnpm_library" });

    const commands = recommendation.config.oracles.map((oracle) => ({
      args: oracle.args,
      command: oracle.command,
      id: oracle.id,
    }));
    expect(commands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "npm", args: ["pack", "--dry-run"] }),
      ]),
    );
    expect(recommendation.selection.oracleIds).not.toContain("package-smoke-deep");
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });
});
