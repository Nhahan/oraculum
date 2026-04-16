import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getProfileSelectionPath, getReportsDir } from "../src/core/paths.js";
import { initializeProject } from "../src/services/project.js";
import {
  createTempRoot,
  recommendFallbackProfile,
  registerConsultationProfileTempRootCleanup,
  writeFrontendPackage,
  writePrismaMigrationPackage,
} from "./helpers/consultation-profile.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile fallback: frontend and migration execution signals", () => {
  it("keeps Playwright signals as evidence without inventing deep checks", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFrontendPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_frontend"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_frontend" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).not.toContain("e2e-deep");
    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_frontend"), "utf8"),
    ) as {
      signals: {
        skippedCommandCandidates: Array<{
          capability: string;
          id: string;
          provenance?: { path?: string; signal: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(artifact.signals.skippedCommandCandidates).toContainEqual(
      expect.objectContaining({
        capability: "e2e-or-visual",
        detail:
          "Test-runner evidence was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
        id: "e2e-deep",
        reason: "missing-explicit-command",
        provenance: expect.objectContaining({
          path: "playwright.config.ts",
          signal: "test-runner:playwright",
          source: "root-config",
        }),
      }),
    );
  });
  it("detects common frontend config filename variants without generating tool commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "demo-frontend-config-variants",
          type: "module",
          devDependencies: {
            "@playwright/test": "^1.55.0",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(join(cwd, ".storybook"), { recursive: true });
    await writeFile(join(cwd, ".storybook", "main.mjs"), "export default {};\n", "utf8");
    await writeFile(join(cwd, "playwright.config.mjs"), "export default {};\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_frontend_variants"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_frontend_variants" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.signals).toEqual(
      expect.arrayContaining(["frontend-config-evidence", "e2e-runner-evidence"]),
    );
    expect(recommendation.selection.oracleIds).not.toContain("e2e-deep");
    const e2eOracle = recommendation.config.oracles.find((oracle) => oracle.id === "e2e-deep");
    expect(e2eOracle).toBeUndefined();
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
  });
  it("does not use repo-local frontend binaries unless a repo-local script exposes them", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFrontendPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_frontend_local_tool"), { recursive: true });
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await writeNodeBinary(join(cwd, "node_modules", ".bin"), "playwright", "process.exit(0);\n");

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_frontend_local_tool",
    });

    const e2eOracle = recommendation.config.oracles.find((oracle) => oracle.id === "e2e-deep");
    expect(e2eOracle).toBeUndefined();
    expect(recommendation.selection.profileId).toBe("generic");
  });
  it("uses an explicit repo-local e2e script as frontend profile evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "explicit-e2e",
          packageManager: "npm@10.0.0",
          scripts: {
            e2e: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_explicit_e2e"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_explicit_e2e" });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.candidateCount).toBe(4);
    expect(recommendation.selection.oracleIds).toContain("e2e-deep");
    expect(recommendation.selection.strategyIds).toEqual(["minimal-change", "safety-first"]);
    expect(recommendation.selection.signals).toEqual(
      expect.arrayContaining(["repo-local-validation", "repo-e2e-anchor"]),
    );
  });
  it("uses an explicit repo-local migration script as migration profile evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "explicit-migration",
          packageManager: "npm@10.0.0",
          scripts: {
            "migration:dry-run": 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_explicit_migration"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_explicit_migration" });

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.candidateCount).toBe(4);
    expect(recommendation.selection.oracleIds).toContain("migration-impact");
    expect(recommendation.selection.strategyIds).toEqual(["minimal-change", "safety-first"]);
    expect(recommendation.selection.signals).toEqual(
      expect.arrayContaining(["repo-local-validation", "repo-migration-anchor"]),
    );
  });
  it("records Prisma migration signals without inventing direct commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writePrismaMigrationPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_migration"), { recursive: true });

    const recommendation = await recommendFallbackProfile({ cwd, runId: "run_migration" });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).not.toContain("schema-fast");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.oracleIds).not.toContain("migration-drift-deep");
    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_migration"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        commandCatalog: Array<{ command: string; id: string }>;
        skippedCommandCandidates: Array<{
          capability: string;
          id: string;
          provenance?: { path?: string; signal: string; source: string };
          reason: string;
        }>;
      };
    };
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "migration-tool",
        path: "prisma/schema.prisma",
        source: "root-config",
        value: "prisma",
      }),
    );
    expect(artifact.signals.commandCatalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "/usr/local/bin/prisma" }),
        expect.objectContaining({ command: "prisma" }),
      ]),
    );
    expect(artifact.signals.skippedCommandCandidates).toContainEqual(
      expect.objectContaining({
        capability: "migration-dry-run",
        detail:
          "Migration-tool evidence was detected, but no repo-local migration validation script or explicit oracle exposes the executable command.",
        id: "migration-impact",
        reason: "missing-explicit-command",
        provenance: expect.objectContaining({
          path: "prisma/schema.prisma",
          signal: "migration-tool:prisma",
          source: "root-config",
        }),
      }),
    );
  });
  it("does not generate Prisma migration commands when migration history lacks a schema file", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await mkdir(join(cwd, "prisma", "migrations", "0001_init"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "demo-migration-missing-schema",
          packageManager: "npm@10.0.0",
          type: "module",
          dependencies: {
            prisma: "^6.0.0",
            "@prisma/client": "^6.0.0",
          },
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(cwd, "prisma", "migrations", "0001_init", "migration.sql"),
      "-- migration\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_migration_missing_schema"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_migration_missing_schema",
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).not.toContain("schema-fast");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.oracleIds).not.toContain("migration-drift-deep");
  });
  it("keeps Prisma migration validation explicit instead of depending on discovered binaries", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writePrismaMigrationPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_migration_missing_tool"), { recursive: true });

    const recommendation = await recommendFallbackProfile({
      cwd,
      runId: "run_migration_missing_tool",
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).not.toContain("schema-fast");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.oracleIds).not.toContain("migration-drift-deep");
  });
});
