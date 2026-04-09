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
import {
  recommendConsultationProfile,
  setToolPathFinderForTests,
} from "../src/services/consultation-profile.js";
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
  setToolPathFinderForTests(undefined);
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
      "unit-impact",
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
      oracles?: Array<{ id: string; args?: string[] }>;
    };
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

    expect(recommendation.config.oracles).toHaveLength(6);
    expect(recommendation.config.oracles.every((oracle) => oracle.cwd === "workspace")).toBe(true);
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

  it("defaults zero-signal fallback detection to the library profile", async () => {
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

    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.summary).toContain("defaulted to the safest library profile");
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
  });

  it("auto-generates deep frontend checks from Playwright signals even without scripts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFrontendPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_frontend"), { recursive: true });
    setToolPathFinderForTests((tool) =>
      tool === "playwright" ? "/usr/local/bin/playwright" : undefined,
    );

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

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toContain("e2e-deep");
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("prefers repo-local frontend tools over global PATH tools for deep checks", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nUpdate the page title.\n", "utf8");
    await writeFrontendPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_frontend_local_tool"), { recursive: true });
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await writeNodeBinary(join(cwd, "node_modules", ".bin"), "playwright", "process.exit(0);\n");
    setToolPathFinderForTests((tool) =>
      tool === "playwright" ? "/usr/local/bin/playwright" : undefined,
    );

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
    expect(e2eOracle?.command).toContain(join("node_modules", ".bin", "playwright"));
    expect(e2eOracle?.args).toEqual(["test"]);
  });

  it("auto-generates prisma migration deep checks without custom scripts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writePrismaMigrationPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_migration"), { recursive: true });
    setToolPathFinderForTests((tool) => (tool === "prisma" ? "/usr/local/bin/prisma" : undefined));

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

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toEqual(
      expect.arrayContaining(["schema-fast", "migration-impact", "migration-drift-deep"]),
    );
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("treats missing Prisma binaries as a deep-check gap instead of generating a failing command", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nAdjust the migration.\n", "utf8");
    await writePrismaMigrationPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_migration_missing_tool"), { recursive: true });
    setToolPathFinderForTests(() => undefined);

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

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.oracleIds).not.toContain("schema-fast");
    expect(recommendation.selection.oracleIds).not.toContain("migration-impact");
    expect(recommendation.selection.oracleIds).not.toContain("migration-drift-deep");
    expect(recommendation.selection.missingCapabilities).toContain(
      "No schema validation command was detected.",
    );
    expect(recommendation.selection.missingCapabilities).toContain(
      "No migration planning or dry-run command was detected.",
    );
    expect(recommendation.selection.missingCapabilities).toContain(
      "No rollback simulation or migration drift deep check was detected.",
    );
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
  recommendation:
    | {
        profileId: "library" | "frontend" | "migration";
        confidence: "low" | "medium" | "high";
        summary: string;
        candidateCount: number;
        strategyIds: string[];
        selectedCommandIds: string[];
        missingCapabilities: string[];
      }
    | undefined,
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
