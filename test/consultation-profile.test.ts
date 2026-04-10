import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import {
  getAdvancedConfigPath,
  getConfigPath,
  getProfileSelectionPath,
  getReportsDir,
} from "../src/core/paths.js";
import type { AgentProfileRecommendation } from "../src/domain/profile.js";
import { recommendConsultationProfile } from "../src/services/consultation-profile.js";
import {
  initializeProject,
  loadProjectConfig,
  loadProjectConfigLayers,
} from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import { loadTaskPacket } from "../src/services/task-packets.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("consultation auto profile", () => {
  it("applies an auto-selected library profile when quick-start settings are still implicit", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts and package export signals are strongest.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","unit-impact","full-suite-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix.md",
      agent: "codex",
      autoProfile: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.profileSelection?.profileId).toBe("library");
    expect(manifest.candidateCount).toBe(4);
    expect(manifest.profileSelection?.strategyIds).toEqual([
      "minimal-change",
      "test-amplified",
      "minimal-change-3",
      "test-amplified-4",
    ]);
    const savedManifest = await readRunManifest(cwd, manifest.id);
    expect(savedManifest.profileSelection?.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "pack-impact",
      "full-suite-deep",
      "package-smoke-deep",
    ]);
    const configPath = savedManifest.configPath;
    expect(configPath).toBeDefined();
    if (!configPath) {
      throw new Error("expected consultation config path to be recorded");
    }
    const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      oracles?: Array<{ id: string; args?: string[]; command?: string; timeoutMs?: number }>;
    };
    expect(
      savedConfig.oracles?.filter(
        (oracle) => oracle.command === "npm" && oracle.args?.join(" ") === "run test",
      ),
    ).toHaveLength(1);
    expect(savedConfig.oracles?.every((oracle) => typeof oracle.timeoutMs === "number")).toBe(true);
    const packageSmokeDeep = savedConfig.oracles?.find(
      (oracle) => oracle.id === "package-smoke-deep",
    );
    expect(packageSmokeDeep?.args?.join(" ")).toContain(
      "process.platform === 'win32' ? 'npm.cmd' : 'npm'",
    );
    expect(packageSmokeDeep?.args?.join(" ")).toContain("shell: process.platform === 'win32'");
    await expect(readFile(getProfileSelectionPath(cwd, manifest.id), "utf8")).resolves.toContain(
      '"profileId": "library"',
    );
  });

  it("keeps explicit quick and advanced settings while still recording the auto profile decision", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify({ version: 1, defaultCandidates: 2 }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "custom-impact",
              roundId: "impact",
              command: "npm",
              args: ["run", "test"],
              invariant: "Custom test check.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix.md",
      agent: "codex",
      autoProfile: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.candidateCount).toBe(2);
    expect(manifest.profileSelection?.profileId).toBe("library");
    expect(manifest.profileSelection?.oracleIds).toEqual(["custom-impact"]);
    expect(manifest.profileSelection?.missingCapabilities).toEqual([]);
    expect(manifest.profileSelection?.strategyIds).toEqual(["minimal-change", "test-amplified"]);
  });

  it("generates workspace-scoped profile oracles for consultation defaults", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_profile"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "library",
        confidence: "high",
        summary: "Library defaults fit this repository.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "unit-impact", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_profile"),
      runId: "run_profile",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.config.oracles).toHaveLength(5);
    expect(recommendation.config.oracles.every((oracle) => oracle.cwd === "workspace")).toBe(true);
    expect(recommendation.config.oracles.every((oracle) => oracle.timeoutMs !== undefined)).toBe(
      true,
    );
  });

  it("can skip runtime profile selection and rely on fallback detection for planning-only flows", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_draft"), { recursive: true });

    let called = false;
    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined, () => {
        called = true;
      }),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_draft"),
      runId: "run_draft",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(called).toBe(false);
    expect(recommendation.selection.source).toBe("fallback-detection");
    await expect(readFile(getProfileSelectionPath(cwd, "run_draft"), "utf8")).resolves.toContain(
      '"llmSkipped": true',
    );
  });

  it("defaults zero-signal fallback detection to the generic profile", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await mkdir(getReportsDir(cwd, "run_zero_signals"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_zero_signals"),
      runId: "run_zero_signals",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.candidateCount).toBe(3);
    expect(recommendation.selection.summary).toContain("defaulted to the generic profile");
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

  it("does not let English task keywords choose a profile without repo evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix.md"),
      "# Fix\nFrontend React migration schema database UI work.\n",
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_task_keyword_only"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_task_keyword_only"),
      runId: "run_task_keyword_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.signals).not.toEqual(
      expect.arrayContaining(["task-frontend", "task-migration"]),
    );
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_react_only"),
      runId: "run_react_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
  });

  it("adds a package tarball deep check for exportable libraries during fallback detection", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep package exports healthy.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_library_pack"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_library_pack"),
      runId: "run_library_pack",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.oracleIds).toContain("package-smoke-deep");
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
        expect.objectContaining({ kind: "intent", value: "library" }),
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
        safety: "product-owned-temporary",
        source: "product-owned",
        safetyRationale: expect.stringContaining("temporary directory"),
      }),
    );
    expect(artifact.signals.skippedCommandCandidates).toEqual([]);
  });

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

    await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_duplicate_aliases"),
      runId: "run_duplicate_aliases",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_duplicate_bodies"),
      runId: "run_duplicate_bodies",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const testOracles = recommendation.config.oracles.filter(
      (oracle) =>
        oracle.command === "npm" &&
        (oracle.args.join(" ") === "run unit" || oracle.args.join(" ") === "run test"),
    );
    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.oracleIds).toContain("unit-impact");
    expect(recommendation.selection.oracleIds).not.toContain("full-suite-deep");
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No package packaging smoke check was detected.",
    ]);
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_nested_workspace"),
      runId: "run_nested_workspace",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_workspace"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; source: string; value: string }>;
        workspaceRoots: string[];
      };
    };
    expect(artifact.signals.workspaceRoots).toEqual(["packages/app"]);
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_nested_frontend"),
      runId: "run_nested_frontend",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_frontend"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
        tags: string[];
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
    expect(artifact.signals.tags).toEqual(expect.arrayContaining(["frontend-build", "e2e-config"]));
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
        signal: "tag:e2e-config",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "packages/app/vite.config.ts",
        signal: "tag:frontend-build",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
  });

  it("uses nested workspace migration files as profile signals without inventing unsafe commands", async () => {
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_nested_migration"),
      runId: "run_nested_migration",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_nested_migration"), "utf8"),
    ) as {
      signals: {
        commandCatalog: Array<{ command: string }>;
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
        tags: string[];
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toContain(
      "No repo-local validation command was detected.",
    );
    expect(artifact.signals.tags).toContain("migration-files");
    expect(artifact.signals.capabilities).not.toContainEqual(
      expect.objectContaining({ kind: "intent", value: "migration" }),
    );
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "migration-tool",
        path: "services/api/alembic.ini",
        source: "workspace-config",
        value: "alembic",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "services/api/alembic.ini",
        signal: "tag:migration-files",
        source: "workspace-config",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
  });

  it("detects non-Prisma migration capabilities without inventing unsafe commands", async () => {
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_drizzle_migration"),
      runId: "run_drizzle_migration",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_drizzle_migration"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        commandCatalog: Array<{ command: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "migration-tool",
        path: "drizzle.config.ts",
        source: "root-config",
        value: "drizzle",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "drizzle.config.ts",
        signal: "tag:migration-files",
        source: "root-config",
      }),
    );
    expect(artifact.signals.commandCatalog).toEqual([]);
  });

  it("detects dependency-only non-Prisma migration tools without inventing commands", async () => {
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_knex_migration"),
      runId: "run_knex_migration",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    const artifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_knex_migration"), "utf8"),
    ) as {
      signals: {
        capabilities: Array<{ kind: string; path?: string; source: string; value: string }>;
        commandCatalog: Array<{ command: string }>;
        provenance: Array<{ path?: string; signal: string; source: string }>;
      };
    };
    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(artifact.signals.capabilities).toContainEqual(
      expect.objectContaining({
        kind: "migration-tool",
        path: "package.json",
        source: "root-config",
        value: "knex",
      }),
    );
    expect(artifact.signals.provenance).toContainEqual(
      expect.objectContaining({
        path: "package.json",
        signal: "tag:migration-tooling",
        source: "root-config",
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

    await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_lockfile_only"),
      runId: "run_lockfile_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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

    await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_unknown_package_manager"),
      runId: "run_unknown_package_manager",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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
      "No lockfile or packageManager field was detected; package scripts were not auto-generated because the package manager is ambiguous.",
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_pnpm_library"),
      runId: "run_pnpm_library",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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
    expect(recommendation.selection.missingCapabilities).toContain(
      "No package packaging smoke check was detected.",
    );
  });

  it("keeps Playwright signals as evidence without inventing deep checks", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFrontendPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_frontend"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend"),
      runId: "run_frontend",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend_variants"),
      runId: "run_frontend_variants",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.signals).toEqual(
      expect.arrayContaining(["frontend-build", "e2e-config"]),
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend_local_tool"),
      runId: "run_frontend_local_tool",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_explicit_e2e"),
      runId: "run_explicit_e2e",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toContain("e2e-deep");
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_explicit_migration"),
      runId: "run_explicit_migration",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toContain("migration-impact");
  });

  it("records Prisma migration signals without inventing direct commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writePrismaMigrationPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_migration"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_migration"),
      runId: "run_migration",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_migration_missing_schema"),
      runId: "run_migration_missing_schema",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
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

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_migration_missing_tool"),
      runId: "run_migration_missing_tool",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).not.toContain("schema-fast");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.oracleIds).not.toContain("migration-drift-deep");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oraculum-profile-"));
  tempRoots.push(root);
  return root;
}

async function writeLibraryPackage(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-library",
        packageManager: "npm@10.0.0",
        type: "module",
        main: "dist/index.js",
        exports: "./dist/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeFrontendPackage(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-frontend",
        packageManager: "npm@10.0.0",
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "@playwright/test": "^1.55.0",
        },
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(cwd, "playwright.config.ts"), "export default {};\n", "utf8");
}

async function writePrismaMigrationPackage(cwd: string): Promise<void> {
  await mkdir(join(cwd, "prisma", "migrations"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "demo-migration",
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
    join(cwd, "prisma", "schema.prisma"),
    'generator client { provider = "prisma-client-js" }\ndatasource db { provider = "sqlite" url = "file:dev.db" }\nmodel User { id Int @id }\n',
    "utf8",
  );
  await writeFile(
    join(cwd, "prisma", "migrations", "README.md"),
    "placeholder migration history\n",
    "utf8",
  );
}

function createNoopProfileAdapter(
  recommendation: AgentProfileRecommendation | undefined,
  onRecommendProfile?: () => void,
): AgentAdapter {
  return {
    name: "codex",
    async runCandidate() {
      throw new Error("not used");
    },
    async recommendWinner() {
      throw new Error("not used");
    },
    async recommendProfile(request) {
      onRecommendProfile?.();
      return {
        runId: request.runId,
        adapter: "codex",
        status: recommendation ? "completed" : "failed",
        startedAt: "2026-04-07T00:00:00.000Z",
        completedAt: "2026-04-07T00:00:01.000Z",
        exitCode: recommendation ? 0 : 1,
        summary: recommendation
          ? "Profile recommendation completed."
          : "Profile recommendation skipped.",
        ...(recommendation ? { recommendation } : {}),
        artifacts: [],
      };
    },
  };
}
