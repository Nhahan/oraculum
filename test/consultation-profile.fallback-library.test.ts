import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getProfileSelectionPath, getReportsDir } from "../src/core/paths.js";
import { initializeProject } from "../src/services/project.js";
import {
  createTempRoot,
  recommendFallbackProfile,
  registerConsultationProfileTempRootCleanup,
  writeLibraryPackage,
} from "./helpers/consultation-profile.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile fallback: library and anchor signals", () => {
  it("surfaces workspace-only package export signals as library intent evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep exports healthy.\n", "utf8");
    await mkdir(join(cwd, "packages", "lib"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "lib", "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-lib",
          packageManager: "pnpm@10.0.0",
          exports: "./dist/index.js",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_workspace_library_export"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_workspace_library_export",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_library_export"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{
          detail?: string;
          kind: string;
          path?: string;
          source: string;
          value: string;
        }>;
        skippedCommandCandidates: Array<{
          detail: string;
          id: string;
          provenance?: { path?: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "build-system",
        value: "package-export-metadata",
        source: "workspace-config",
        path: "packages/lib/package.json",
        detail: "Workspace package export metadata is present.",
      }),
    );
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({
        kind: "intent",
        source: "fallback-inference",
        value: "unknown",
      }),
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pack-impact",
          reason: "unsupported-package-manager",
          provenance: expect.objectContaining({
            path: "packages/lib/package.json",
            source: "workspace-config",
          }),
        }),
        expect.objectContaining({
          id: "package-smoke-deep",
          reason: "unsupported-package-manager",
        }),
      ]),
    );
  });
  it("keeps workspace packaging smoke checks as evidence without forcing a library fallback profile", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep workspace exports healthy.\n",
      "utf8",
    );
    await mkdir(join(cwd, "packages", "lib"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "lib", "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-lib",
          version: "1.0.0",
          packageManager: "npm@10.0.0",
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
    await mkdir(getReportsDir(cwd, "run_workspace_library_pack"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_workspace_library_pack",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_library_pack"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{
          capability?: string;
          id: string;
          provenance?: { path?: string; source: string };
          relativeCwd?: string;
        }>;
        notes: string[];
        skippedCommandCandidates: Array<{ id: string }>;
      };
    };

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
    const lintOracle = recommendation.config.oracles.find((oracle) => oracle.id === "lint-fast");
    const packOracle = recommendation.config.oracles.find((oracle) => oracle.id === "pack-impact");
    const packageSmokeOracle = recommendation.config.oracles.find(
      (oracle) => oracle.id === "package-smoke-deep",
    );
    expect(lintOracle).toEqual(
      expect.objectContaining({
        command: "npm",
        args: ["run", "lint"],
        relativeCwd: "packages/lib",
      }),
    );
    expect(lintOracle?.safetyRationale).toContain("workspace package.json script");
    expect(packOracle).toBeUndefined();
    expect(packageSmokeOracle).toBeUndefined();
    expect(artifact.signals.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "package-export-smoke",
          id: "pack-impact",
          relativeCwd: "packages/lib",
          provenance: expect.objectContaining({
            path: "packages/lib/package.json",
            signal: "build-system:package-export-metadata",
            source: "workspace-config",
          }),
        }),
        expect.objectContaining({
          capability: "package-export-smoke",
          id: "package-smoke-deep",
          relativeCwd: "packages/lib",
          provenance: expect.objectContaining({
            path: "packages/lib/package.json",
            signal: "build-system:package-export-metadata",
            source: "workspace-config",
          }),
        }),
      ]),
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual([]);
    expect(artifact.signals.notes).not.toContain(
      "Package export metadata signals were detected, but no packaging verification command was auto-generated.",
    );
  });
  it("records ambiguous package export smoke evidence instead of guessing among multiple exportable packages", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep exports healthy.\n", "utf8");
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "npm@10.0.0" }\n', "utf8");
    for (const workspaceRoot of ["packages/lib-a", "packages/lib-b"]) {
      await mkdir(join(cwd, workspaceRoot), { recursive: true });
      await writeFile(
        join(cwd, workspaceRoot, "package.json"),
        `${JSON.stringify(
          {
            name: workspaceRoot,
            version: "1.0.0",
            exports: "./dist/index.js",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    await mkdir(getReportsDir(cwd, "run_workspace_library_ambiguous"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_workspace_library_ambiguous",
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_workspace_library_ambiguous"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ id: string }>;
        skippedCommandCandidates: Array<{ detail: string; id: string; reason: string }>;
      };
    };

    expect(recommendation.selection.profileId).toBe("generic");
    expect(artifact.signals.commandCatalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pack-impact" }),
        expect.objectContaining({ id: "package-smoke-deep" }),
      ]),
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pack-impact",
          reason: "ambiguous-workspace-command",
          detail: expect.stringContaining("packages/lib-a/package.json"),
          provenance: expect.objectContaining({
            signal: "build-system:package-export-metadata",
          }),
        }),
        expect.objectContaining({
          id: "package-smoke-deep",
          reason: "ambiguous-workspace-command",
          detail: expect.stringContaining("packages/lib-b/package.json"),
          provenance: expect.objectContaining({
            signal: "build-system:package-export-metadata",
          }),
        }),
      ]),
    );
  });
  it("keeps root packaging smoke checks as evidence without forcing a library fallback profile", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep package exports healthy.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_library_pack"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_library_pack" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_library_pack"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{ kind: string; value: string }>;
        commandCatalog: Array<{
          capability?: string;
          id: string;
          pathPolicy?: string;
          provenance?: { path?: string; signal: string; source: string };
          safety?: string;
          safetyRationale?: string;
          source?: string;
        }>;
        skippedCommandCandidates: Array<{ id: string }>;
      };
    };
    expect(artifact.signals.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "build-system",
          value: "package-export-metadata",
        }),
        expect.objectContaining({ kind: "language", value: "javascript" }),
        expect.objectContaining({ kind: "command", value: "lint" }),
      ]),
    );
    expect(artifact.signals.commandCatalog).toContainEqual(
      expect.objectContaining({
        capability: "lint",
        id: "lint-fast",
        pathPolicy: "inherit",
        safety: "repo-local-declared",
        source: "repo-local-script",
        provenance: expect.objectContaining({
          path: "package.json",
          signal: "script:lint",
          source: "root-config",
        }),
      }),
    );
    expect(artifact.signals.commandCatalog).toContainEqual(
      expect.objectContaining({
        capability: "package-export-smoke",
        id: "package-smoke-deep",
        pathPolicy: "inherit",
        provenance: expect.objectContaining({
          signal: "build-system:package-export-metadata",
        }),
        safety: "product-owned-temporary",
        source: "product-owned",
        safetyRationale: expect.stringContaining("temporary directory"),
      }),
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual([]);
  });
  it("uses explicit repo-owned frontend evidence without treating product-owned package smoke as a conflicting anchor", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep release and UI checks healthy.\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "conflicting-fallback-anchors",
          packageManager: "npm@10.0.0",
          type: "module",
          exports: "./dist/index.js",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
            e2e: "node -e \"console.log('e2e')\"",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "playwright.config.ts"), "export default {};\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_conflicting_fallback_anchors"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_conflicting_fallback_anchors",
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.summary).toContain(
      "detected a unique frontend validation posture anchor",
    );
    expect(recommendation.selection.summary).not.toContain("pack-impact");
    expect(recommendation.selection.summary).not.toContain("package-smoke-deep");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
      "e2e-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No build validation command was detected.",
    ]);
  });
  it("keeps conflicting explicit anchors on the generic fallback bundle", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nKeep UI and migration checks healthy.\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "explicit-anchor-conflict",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
            e2e: 'node -e "process.exit(0)"',
            "migration:dry-run": 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "playwright.config.ts"), "export default {};\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_anchor_conflict"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_anchor_conflict" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.summary).toContain(
      "defaulted to the generic validation posture because posture-specific validation anchors conflicted",
    );
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.oracleIds).not.toContain("e2e-deep");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });
});
