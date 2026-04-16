import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCommandCatalog } from "../src/services/profile-command-catalog.js";
import { collectExplicitCommandCatalog } from "../src/services/profile-explicit-command-collector.js";
import { collectLocalEntrypointSurfaces } from "../src/services/profile-explicit-command-entrypoints.js";
import { collectPackageScriptSurfaces } from "../src/services/profile-explicit-command-package.js";
import {
  collectJustTargetSurfaces,
  collectMakeTargetSurfaces,
  collectTaskfileTargetSurfaces,
} from "../src/services/profile-explicit-command-task-runners.js";
import { collectProfileRepoFacts } from "../src/services/profile-repo-facts.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-profile-collectors-");
tempRootHarness.registerCleanup();

describe("profile repo facts collector", () => {
  it("records manifests and lockfiles across root and workspace markers", async () => {
    const cwd = await createTempRoot();
    await mkdir(join(cwd, "packages", "api"), { recursive: true });
    await mkdir(join(cwd, "packages", "web"), { recursive: true });
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "pnpm@9.0.0" }\n', "utf8");
    await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(join(cwd, "packages", "api", "pyproject.toml"), "[project]\nname='api'\n");
    await writeFile(join(cwd, "packages", "web", "package.json"), '{ "name": "web" }\n', "utf8");

    const facts = await collectProfileRepoFacts(cwd);

    expect(facts.packageManager).toBe("pnpm");
    expect(facts.workspaceRoots).toEqual(["packages/api", "packages/web"]);
    expect(facts.workspaceMetadata).toEqual([
      {
        label: "api",
        manifests: ["packages/api/pyproject.toml"],
        root: "packages/api",
      },
      {
        label: "web",
        manifests: ["packages/web/package.json"],
        root: "packages/web",
      },
    ]);
    expect(facts.manifests).toEqual([
      "package.json",
      "packages/api/pyproject.toml",
      "packages/web/package.json",
    ]);
    expect(facts.lockfiles).toEqual(["pnpm-lock.yaml"]);
  });

  it("ignores workspace signal paths that are excluded from the managed tree", async () => {
    const cwd = await createTempRoot();
    await mkdir(join(cwd, "packages", "api"), { recursive: true });
    await mkdir(join(cwd, "packages", "docs"), { recursive: true });
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "pnpm@9.0.0" }\n', "utf8");
    await writeFile(join(cwd, "packages", "api", "package.json"), '{ "name": "api" }\n', "utf8");
    await writeFile(join(cwd, "packages", "docs", "package.json"), '{ "name": "docs" }\n', "utf8");

    const facts = await collectProfileRepoFacts(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["packages/docs"],
      },
    });

    expect(facts.workspaceRoots).toEqual(["packages/api"]);
    expect(facts.workspaceMetadata).toEqual([
      {
        label: "api",
        manifests: ["packages/api/package.json"],
        root: "packages/api",
      },
    ]);
    expect(facts.manifests).toEqual(["package.json", "packages/api/package.json"]);
  });

  it("detects a package manager from explicit workspace package metadata", async () => {
    const cwd = await createTempRoot();
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

    expect(facts.packageManager).toBe("pnpm");
    expect(facts.packageManagerEvidence).toEqual({
      detail: "Package manager detected from workspace package metadata.",
      path: "packages/app/package.json",
      source: "workspace-config",
    });
    expect(facts.workspaceRoots).toEqual(["packages/app"]);
  });
});

describe("profile explicit command collector", () => {
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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
    const cwd = await createTempRoot();
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

  it("collects Make, just, and Taskfile targets from explicit repo-local command surfaces", async () => {
    const cwd = await createTempRoot();
    await writeFile(join(cwd, "Makefile"), "lint:\n\t@echo lint\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo test\n",
      "utf8",
    );

    const makeTargets = await collectMakeTargetSurfaces(cwd);
    const justTargets = await collectJustTargetSurfaces(cwd);
    const taskTargets = await collectTaskfileTargetSurfaces(cwd);

    expect(makeTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "lint",
          command: "make",
          args: ["lint"],
          pathPolicy: "inherit",
        }),
      ]),
    );
    expect(justTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "typecheck",
          command: "just",
          args: ["typecheck"],
          pathPolicy: "inherit",
        }),
      ]),
    );
    expect(taskTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "test",
          command: "task",
          args: ["test"],
          pathPolicy: "inherit",
        }),
      ]),
    );
  });

  it("collects repo-local bin and scripts entrypoints when they are unambiguous", async () => {
    const cwd = await createTempRoot();
    await mkdir(join(cwd, "bin"), { recursive: true });
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "bin"), "build", 'process.stdout.write("build\\n");');
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("lint\\n");');

    const result = await collectLocalEntrypointSurfaces(cwd);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "build",
          command: posix.join("bin", "build"),
          args: [],
          pathPolicy: "local-only",
        }),
        expect.objectContaining({
          normalizedName: "lint",
          command: posix.join("scripts", "lint"),
          args: [],
          pathPolicy: "local-only",
        }),
      ]),
    );
  });

  it("records ambiguous root-local entrypoints instead of guessing between bin and scripts", async () => {
    const cwd = await createTempRoot();
    await mkdir(join(cwd, "bin"), { recursive: true });
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "bin"), "lint", 'process.stdout.write("bin\\n");');
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("scripts\\n");');

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lint-fast" })]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-local-command",
          provenance: expect.objectContaining({
            signal: "root-entrypoint:lint",
            source: "local-tool",
          }),
        }),
      ]),
    );
  });

  it("does not surface repo-local entrypoints that the managed tree excludes", async () => {
    const cwd = await createTempRoot();
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("lint\\n");');

    const result = await collectLocalEntrypointSurfaces(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["scripts"],
      },
    });

    expect(result).toEqual([]);
  });

  it("collects unambiguous workspace-local entrypoints with a workspace-relative cwd", async () => {
    const cwd = await createTempRoot();
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

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: posix.join("bin", "lint"),
          args: [],
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: posix.join("scripts", "test"),
          args: [],
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
      ]),
    );
  });

  it("records portable logical provenance for Windows workspace-local entrypoints", async () => {
    const cwd = await createTempRoot();

    await withProcessPlatform("win32", async () => {
      await mkdir(join(cwd, "packages", "app"), { recursive: true });
      await writeFile(join(cwd, "packages", "app", "pyproject.toml"), "[project]\nname='app'\n");
      await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
      await writeNodeBinary(
        join(cwd, "packages", "app", "bin"),
        "lint",
        'process.stdout.write("lint\\n");',
      );

      const result = await collectLocalEntrypointSurfaces(cwd, {
        workspaceRoots: ["packages/app"],
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            normalizedName: "lint",
            command: "bin/lint",
            relativeCwd: "packages/app",
            provenance: expect.objectContaining({
              path: "packages/app/bin/lint",
              signal: "entrypoint:packages/app/bin/lint",
              source: "local-tool",
            }),
          }),
        ]),
      );
    });
  });

  it("records ambiguous workspace-local entrypoints instead of guessing a workspace", async () => {
    const cwd = await createTempRoot();
    for (const workspaceRoot of ["packages/app", "packages/web"]) {
      await mkdir(join(cwd, workspaceRoot), { recursive: true });
      await writeFile(join(cwd, workspaceRoot, "pyproject.toml"), "[project]\nname='app'\n");
      await mkdir(join(cwd, workspaceRoot, "bin"), { recursive: true });
      await writeNodeBinary(
        join(cwd, workspaceRoot, "bin"),
        "lint",
        'process.stdout.write("lint\\n");',
      );
    }

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lint-fast" })]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-workspace-command",
          provenance: expect.objectContaining({
            signal: "workspace-entrypoint:lint",
            source: "local-tool",
          }),
        }),
      ]),
    );
  });

  it("does not surface Make targets that the managed tree excludes", async () => {
    const cwd = await createTempRoot();
    await writeFile(join(cwd, "Makefile"), "typecheck:\n\t@echo typecheck\n", "utf8");

    const result = await collectMakeTargetSurfaces(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["Makefile"],
      },
    });

    expect(result).toEqual([]);
  });

  it("keeps excluded repo-local command surfaces out of the explicit command catalog", async () => {
    const cwd = await createTempRoot();
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "npm@10.0.0" }\n', "utf8");
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("lint\\n");');

    const facts = await collectProfileRepoFacts(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["scripts"],
      },
    });
    const result = await collectExplicitCommandCatalog({
      facts,
      projectRoot: cwd,
      rules: {
        includePaths: [],
        excludePaths: ["scripts"],
      },
    });

    expect(result.commandCatalog).toEqual([]);
  });

  it("records ambiguous explicit command surfaces instead of relying on collector order", async () => {
    const cwd = await createTempRoot();
    await writeFile(join(cwd, "Makefile"), "test:\n\t@echo make-test\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo just-typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo task-test\n",
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "full-suite-deep" })]),
    );
    expect(result.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "typecheck-fast",
          command: "just",
          args: ["typecheck"],
        }),
      ]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "full-suite-deep",
          reason: "ambiguous-explicit-command",
        }),
      ]),
    );
  });
});

async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

async function withProcessPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor);
    }
  }
}
