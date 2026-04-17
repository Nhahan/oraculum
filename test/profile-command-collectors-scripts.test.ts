import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCommandCatalog } from "../src/services/profile-command-catalog.js";
import { collectExplicitCommandCatalog } from "../src/services/profile-explicit-command-collector.js";
import { collectPackageScriptSurfaces } from "../src/services/profile-explicit-command-package.js";
import { collectProfileRepoFacts } from "../src/services/profile-repo-facts.js";
import {
  createProfileCollectorsTempRoot,
  registerProfileCommandCollectorsCleanup,
} from "./helpers/profile-command-collectors.js";

registerProfileCommandCollectorsCleanup();

describe("profile explicit command collector: package scripts", () => {
  it("treats deep e2e capability coverage by capability instead of a built-in command id", () => {
    const result = buildCommandCatalog({
      capabilities: [
        {
          kind: "test-runner",
          value: "playwright",
          source: "root-config",
          confidence: "high",
          path: "playwright.config.ts",
        },
      ],
      explicitCommandCatalog: [
        {
          id: "custom-e2e-check",
          roundId: "deep",
          label: "Custom e2e check",
          command: "npm",
          args: ["run", "qa:e2e"],
          invariant: "Custom deep e2e validation should pass.",
          capability: "e2e-or-visual",
        },
      ],
      explicitSkippedCommandCandidates: [],
      packageJson: undefined,
      packageManager: "unknown",
      workspacePackageJsons: [],
    });

    expect(result.skippedCommandCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "e2e-deep" })]),
    );
  });

  it("treats migration validation coverage by capability instead of built-in command ids", () => {
    const result = buildCommandCatalog({
      capabilities: [
        {
          kind: "migration-tool",
          value: "prisma",
          source: "root-config",
          confidence: "high",
          path: "prisma/schema.prisma",
        },
      ],
      explicitCommandCatalog: [
        {
          id: "custom-migration-verify",
          roundId: "impact",
          label: "Custom migration verify",
          command: "npm",
          args: ["run", "qa:migrate"],
          invariant: "Custom migration validation should pass.",
          capability: "migration-dry-run",
        },
      ],
      explicitSkippedCommandCandidates: [],
      packageJson: undefined,
      packageManager: "unknown",
      workspacePackageJsons: [],
    });

    expect(result.skippedCommandCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "migration-impact" })]),
    );
  });

  it("collects explicit package scripts only when the package manager is known", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          packageManager: "npm@10.0.0",
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

    const facts = await collectProfileRepoFacts(cwd);
    const result = collectPackageScriptSurfaces(facts);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "lint",
          command: "npm",
          args: ["run", "lint"],
          pathPolicy: "inherit",
        }),
        expect.objectContaining({
          normalizedName: "test",
          command: "npm",
          args: ["run", "test"],
          pathPolicy: "inherit",
        }),
      ]),
    );
  });

  it("does not treat tool-specific e2e script names as built-in semantic aliases", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          packageManager: "npm@10.0.0",
          scripts: {
            playwright: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({
      facts,
      projectRoot: cwd,
    });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "e2e-deep" })]),
    );
  });

  it("does not treat tool-specific migration script names as built-in semantic aliases", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          packageManager: "npm@10.0.0",
          scripts: {
            "prisma-migrate-status": 'node -e "process.exit(0)"',
            "prisma-validate": 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({
      facts,
      projectRoot: cwd,
    });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "migration-impact" }),
        expect.objectContaining({ id: "schema-fast" }),
      ]),
    );
  });

  it("does not treat semantic shorthand script names as built-in command vocabulary", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          packageManager: "npm@10.0.0",
          scripts: {
            smoke: 'node -e "process.exit(0)"',
            "migration-status": 'node -e "process.exit(0)"',
            "schema-check": 'node -e "process.exit(0)"',
            check: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({
      facts,
      projectRoot: cwd,
    });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "e2e-deep" }),
        expect.objectContaining({ id: "migration-impact" }),
        expect.objectContaining({ id: "schema-fast" }),
        expect.objectContaining({ id: "full-suite-deep" }),
      ]),
    );
  });

  it("collects an unambiguous workspace package script with a workspace-relative cwd", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
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
          name: "app",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = collectPackageScriptSurfaces(facts);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "lint",
          command: "pnpm",
          args: ["run", "lint"],
          relativeCwd: "packages/app",
        }),
      ]),
    );
  });

  it("collects workspace package scripts when the package manager is explicit only in a workspace manifest", async () => {
    const cwd = await createProfileCollectorsTempRoot();
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

    const facts = await collectProfileRepoFacts(cwd);
    const result = collectPackageScriptSurfaces(facts);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "lint",
          command: "pnpm",
          args: ["run", "lint"],
          relativeCwd: "packages/app",
        }),
      ]),
    );
  });

  it("records ambiguous package scripts instead of guessing npm", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
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

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).toEqual([]);
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-package-manager",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          reason: "ambiguous-package-manager",
        }),
      ]),
    );
  });

  it("records ambiguous package-manager evidence for workspace package scripts", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).toEqual([]);
    expect(result.skippedCommandCandidates).toEqual(
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

  it("records ambiguous workspace package scripts instead of guessing a workspace", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "pnpm@10.0.0" }\n', "utf8");
    for (const workspaceRoot of ["packages/app", "packages/web"]) {
      await mkdir(join(cwd, workspaceRoot), { recursive: true });
      await writeFile(
        join(cwd, workspaceRoot, "package.json"),
        `${JSON.stringify(
          {
            name: workspaceRoot,
            scripts: {
              lint: 'node -e "process.exit(0)"',
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).toEqual([]);
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-workspace-command",
        }),
      ]),
    );
  });
});
