import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AgentAdapter } from "../adapters/types.js";
import { getProfileSelectionPath } from "../core/paths.js";
import { type ProjectConfig, projectConfigSchema, type RepoOracle } from "../domain/config.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
  type ConsultationProfileId,
  type ConsultationProfileSelection,
  consultationProfileSelectionSchema,
  type ProfileCommandCandidate,
  type ProfileRepoSignals,
  profileRepoSignalsSchema,
} from "../domain/profile.js";
import type { MaterializedTaskPacket } from "../domain/task.js";

import { type ProjectConfigLayers, pathExists, writeJsonFile } from "./project.js";

interface RecommendConsultationProfileOptions {
  adapter: AgentAdapter;
  allowRuntime?: boolean;
  baseConfig: ProjectConfig;
  configLayers: ProjectConfigLayers;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}

export interface RecommendedConsultationProfile {
  config: ProjectConfig;
  selection: ConsultationProfileSelection;
}

type ToolPathFinder = (tool: string) => string | undefined;

const PROFILE_DESCRIPTIONS: Record<ConsultationProfileId, string> = {
  library:
    "Package or shared library work. Favor lint/typecheck, unit tests, and package/export evidence.",
  frontend:
    "User-facing frontend work. Favor lint/typecheck, build, changed-area tests, and e2e/visual checks when available.",
  migration:
    "Schema or migration work. Favor schema validation, migration dry-runs, rollback simulation, and conservative strategies.",
};

let toolPathFinder: ToolPathFinder = findToolOnPath;

export function setToolPathFinderForTests(next: ToolPathFinder | undefined): void {
  toolPathFinder = next ?? findToolOnPath;
}

const PROFILE_DEFAULT_CANDIDATES: Record<ConsultationProfileId, number> = {
  library: 4,
  frontend: 4,
  migration: 3,
};

const PROFILE_STRATEGIES: Record<ConsultationProfileId, string[]> = {
  library: ["minimal-change", "test-amplified", "safety-first"],
  frontend: ["minimal-change", "safety-first", "test-amplified"],
  migration: ["safety-first", "structural-refactor", "minimal-change"],
};

const PROFILE_FALLBACK_PRIORITY: ConsultationProfileId[] = ["library", "frontend", "migration"];

const FRONTEND_DEPENDENCIES = new Set([
  "react",
  "react-dom",
  "next",
  "vite",
  "vue",
  "nuxt",
  "svelte",
  "astro",
  "@angular/core",
]);
const MIGRATION_DEPENDENCIES = new Set([
  "prisma",
  "@prisma/client",
  "drizzle-orm",
  "drizzle-kit",
  "knex",
  "sequelize",
  "typeorm",
  "alembic",
]);
const PLAYWRIGHT_DEPENDENCIES = new Set(["playwright", "@playwright/test"]);
const CYPRESS_DEPENDENCIES = new Set(["cypress"]);
const PRISMA_DEPENDENCIES = new Set(["prisma", "@prisma/client"]);

export async function recommendConsultationProfile(
  options: RecommendConsultationProfileOptions,
): Promise<RecommendedConsultationProfile> {
  const signals = await collectProfileRepoSignals(options.projectRoot, options.taskPacket);
  const fallback = buildFallbackRecommendation(signals, options.taskPacket);
  let llmResult: Awaited<ReturnType<AgentAdapter["recommendProfile"]>> | undefined;
  let llmFailure: string | undefined;
  const allowRuntime = options.allowRuntime ?? true;
  if (allowRuntime) {
    try {
      llmResult = await options.adapter.recommendProfile({
        runId: options.runId,
        projectRoot: options.projectRoot,
        logDir: options.reportsDir,
        taskPacket: options.taskPacket,
        signals,
        profileOptions: (
          Object.entries(PROFILE_DESCRIPTIONS) as Array<[ConsultationProfileId, string]>
        ).map(([id, description]) => ({ id, description })),
      });
    } catch (error) {
      llmFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const recommendation =
    llmResult?.status === "completed" && llmResult.recommendation
      ? sanitizeRecommendation(llmResult.recommendation, signals, fallback)
      : fallback;
  const source =
    llmResult?.status === "completed" && llmResult.recommendation
      ? "llm-recommendation"
      : "fallback-detection";

  const applied = applyProfileSelection({
    baseConfig: options.baseConfig,
    configLayers: options.configLayers,
    recommendation,
    signals,
    source,
  });

  const profileSelectionPath = getProfileSelectionPath(options.projectRoot, options.runId);
  await mkdir(dirname(profileSelectionPath), { recursive: true });
  await writeJsonFile(profileSelectionPath, {
    signals,
    ...(!allowRuntime ? { llmSkipped: true } : {}),
    ...(llmFailure ? { llmFailure } : {}),
    llmResult,
    recommendation,
    appliedSelection: applied.selection,
  });

  return applied;
}

function applyProfileSelection(options: {
  baseConfig: ProjectConfig;
  configLayers: ProjectConfigLayers;
  recommendation: AgentProfileRecommendation;
  signals: ProfileRepoSignals;
  source: ConsultationProfileSelection["source"];
}): RecommendedConsultationProfile {
  const strategyIds = resolveStrategyIds(options.baseConfig, options.recommendation.strategyIds);
  const generatedOracles = buildGeneratedOracles(
    options.recommendation.selectedCommandIds,
    options.signals.commandCatalog,
  );

  const explicitCandidateCount =
    options.configLayers.usesLegacyConfig ||
    options.configLayers.quick.defaultCandidates !== undefined;
  const explicitStrategies =
    options.configLayers.usesLegacyConfig ||
    options.configLayers.advanced?.strategies !== undefined;
  const explicitOracles =
    options.configLayers.usesLegacyConfig || options.configLayers.advanced?.oracles !== undefined;

  const effectiveCandidateCount = explicitCandidateCount
    ? options.baseConfig.defaultCandidates
    : clampCandidateCount(options.recommendation.candidateCount);
  const effectiveStrategies = explicitStrategies
    ? options.baseConfig.strategies
    : options.baseConfig.strategies.filter((strategy) => strategyIds.includes(strategy.id));
  const effectiveOracles = explicitOracles ? options.baseConfig.oracles : generatedOracles;

  const config = projectConfigSchema.parse({
    ...options.baseConfig,
    defaultCandidates: effectiveCandidateCount,
    strategies: effectiveStrategies,
    oracles: effectiveOracles,
  });

  return {
    config,
    selection: consultationProfileSelectionSchema.parse({
      profileId: options.recommendation.profileId,
      confidence: options.recommendation.confidence,
      source: options.source,
      summary: options.recommendation.summary,
      candidateCount: effectiveCandidateCount,
      strategyIds: effectiveStrategies.map((strategy) => strategy.id),
      oracleIds: effectiveOracles.map((oracle) => oracle.id),
      missingCapabilities: explicitOracles ? [] : options.recommendation.missingCapabilities,
      signals: options.signals.tags,
    }),
  };
}

async function collectProfileRepoSignals(
  projectRoot: string,
  taskPacket: MaterializedTaskPacket,
): Promise<ProfileRepoSignals> {
  const packageJsonPath = join(projectRoot, "package.json");
  const packageJson = (await pathExists(packageJsonPath))
    ? (JSON.parse(await readFile(packageJsonPath, "utf8")) as {
        packageManager?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      })
    : undefined;
  const packageManager = await detectPackageManager(projectRoot, packageJson?.packageManager);
  const scripts = Object.keys(packageJson?.scripts ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
  const dependencies = Object.keys({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }).sort((left, right) => left.localeCompare(right));

  const knownFiles = await detectKnownFiles(projectRoot);
  const tags = buildSignalTags({
    dependencies,
    files: knownFiles,
    scripts,
    taskPacket,
    packageJson,
  });
  const commandCatalog = buildCommandCatalog({
    dependencies,
    files: knownFiles,
    packageJson,
    packageManager,
    projectRoot,
    scripts,
  });
  const notes = buildSignalNotes(tags, commandCatalog, packageManager, packageJson);

  return profileRepoSignalsSchema.parse({
    packageManager,
    scripts,
    dependencies,
    files: knownFiles,
    tags,
    notes,
    commandCatalog,
  });
}

async function detectPackageManager(
  projectRoot: string,
  packageManagerField: string | undefined,
): Promise<ProfileRepoSignals["packageManager"]> {
  if (packageManagerField?.startsWith("pnpm")) {
    return "pnpm" as const;
  }
  if (packageManagerField?.startsWith("yarn")) {
    return "yarn" as const;
  }
  if (packageManagerField?.startsWith("bun")) {
    return "bun" as const;
  }
  if (packageManagerField?.startsWith("npm")) {
    return "npm" as const;
  }

  const lockfiles: Array<[string, ProfileRepoSignals["packageManager"]]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];

  for (const [filename, manager] of lockfiles) {
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, filename))) {
      return manager;
    }
  }

  return "unknown" as const;
}

async function detectKnownFiles(projectRoot: string): Promise<string[]> {
  const candidates = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "playwright.config.ts",
    "playwright.config.js",
    "cypress.config.ts",
    "cypress.config.js",
    "storybook/main.ts",
    "storybook/main.js",
    "prisma/schema.prisma",
    "schema.prisma",
    "drizzle.config.ts",
    "alembic.ini",
    "migrations",
    "db/migrate",
    "prisma/migrations",
  ];

  const present: string[] = [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, candidate))) {
      present.push(candidate);
    }
  }

  return present;
}

function buildSignalTags(options: {
  dependencies: string[];
  files: string[];
  scripts: string[];
  taskPacket: MaterializedTaskPacket;
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined;
}): string[] {
  const tags = new Set<string>();

  if (options.dependencies.some((dependency) => FRONTEND_DEPENDENCIES.has(dependency))) {
    tags.add("frontend-framework");
  }
  if (options.dependencies.some((dependency) => MIGRATION_DEPENDENCIES.has(dependency))) {
    tags.add("migration-tooling");
  }
  if (
    options.files.some((file) =>
      [
        "vite.config.ts",
        "vite.config.js",
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "storybook/main.ts",
        "storybook/main.js",
      ].includes(file),
    )
  ) {
    tags.add("frontend-build");
  }
  if (
    options.files.some((file) =>
      [
        "playwright.config.ts",
        "playwright.config.js",
        "cypress.config.ts",
        "cypress.config.js",
      ].includes(file),
    )
  ) {
    tags.add("e2e-config");
  }
  if (
    options.files.some((file) =>
      [
        "schema.prisma",
        "prisma/schema.prisma",
        "migrations",
        "db/migrate",
        "prisma/migrations",
        "alembic.ini",
      ].includes(file),
    )
  ) {
    tags.add("migration-files");
  }
  if (
    options.packageJson?.exports !== undefined ||
    options.packageJson?.main ||
    options.packageJson?.module ||
    options.packageJson?.types
  ) {
    tags.add("package-export");
  }
  if (options.scripts.includes("lint")) {
    tags.add("lint-script");
  }
  if (options.scripts.some((script) => ["typecheck", "check-types", "tsc"].includes(script))) {
    tags.add("typecheck-script");
  }
  if (options.scripts.includes("build")) {
    tags.add("build-script");
  }
  if (options.scripts.some((script) => script === "test" || script.includes("test:"))) {
    tags.add("test-script");
  }
  if (
    options.scripts.some((script) => /(migrate|migration|rollback|schema|db:|prisma)/u.test(script))
  ) {
    tags.add("migration-script");
  }
  if (/(migration|schema|rollback|database|prisma)/iu.test(taskText(options.taskPacket))) {
    tags.add("task-migration");
  }
  if (
    /(frontend|ui|component|page|screen|css|style|react|next|vite)/iu.test(
      taskText(options.taskPacket),
    )
  ) {
    tags.add("task-frontend");
  }
  if (
    !tags.has("frontend-framework") &&
    !tags.has("migration-tooling") &&
    tags.has("package-export")
  ) {
    tags.add("library-signal");
  }

  return [...tags].sort((left, right) => left.localeCompare(right));
}

function buildSignalNotes(
  tags: string[],
  commandCatalog: ProfileCommandCandidate[],
  packageManager: ProfileRepoSignals["packageManager"],
  packageJson:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined,
): string[] {
  const notes: string[] = [];
  if (
    tags.includes("package-export") &&
    commandCatalog.every(
      (command) => command.id !== "pack-impact" && command.id !== "package-smoke-deep",
    )
  ) {
    notes.push(
      "Package export signals were detected, but no packaging verification command was auto-generated.",
    );
  }
  if (packageManager === "unknown") {
    notes.push(
      "No lockfile or packageManager field was detected; npm-compatible script commands were assumed only when scripts exist.",
    );
  }
  if (!packageJson) {
    notes.push(
      "No package.json was found; the profile recommendation relies on files and task text only.",
    );
  }

  return notes;
}

function buildCommandCatalog(options: {
  dependencies: string[];
  files: string[];
  packageJson:
    | {
        scripts?: Record<string, string>;
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined;
  packageManager: ProfileRepoSignals["packageManager"];
  projectRoot: string;
  scripts: string[];
}): ProfileCommandCandidate[] {
  const scripts = new Set(options.scripts);
  const dependencies = new Set(options.dependencies);
  const files = new Set(options.files);
  const catalog: ProfileCommandCandidate[] = [];

  const addScriptCommand = (
    id: string,
    roundId: ProfileCommandCandidate["roundId"],
    label: string,
    script: string,
    invariant: string,
  ) => {
    if (!scripts.has(script)) {
      return;
    }
    const command = buildScriptCommand(options.packageManager, script);
    if (!command) {
      return;
    }
    catalog.push({
      id,
      roundId,
      label,
      command: command.command,
      args: command.args,
      invariant,
    });
  };

  const addDirectToolCommand = (
    id: string,
    roundId: ProfileCommandCandidate["roundId"],
    label: string,
    invariant: string,
    tool: string,
    toolArgs: string[],
  ) => {
    if (catalog.some((command) => command.id === id)) {
      return;
    }
    const command = buildToolExecCommand(
      options.projectRoot,
      options.packageManager,
      tool,
      toolArgs,
    );
    if (!command) {
      return;
    }
    catalog.push({
      id,
      roundId,
      label,
      command: command.command,
      args: command.args,
      invariant,
    });
  };

  addScriptCommand("lint-fast", "fast", "Lint", "lint", "The codebase should satisfy lint checks.");
  for (const script of ["typecheck", "check-types", "tsc"]) {
    addScriptCommand(
      "typecheck-fast",
      "fast",
      "Typecheck",
      script,
      "The codebase should satisfy type checking.",
    );
    if (catalog.some((command) => command.id === "typecheck-fast")) {
      break;
    }
  }
  for (const script of ["schema:check", "check:schema", "db:schema", "prisma:validate"]) {
    addScriptCommand(
      "schema-fast",
      "fast",
      "Schema validation",
      script,
      "Schema definitions should validate cleanly.",
    );
    if (catalog.some((command) => command.id === "schema-fast")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "schema-fast") &&
    files.has("prisma/schema.prisma") &&
    dependenciesIntersection(dependencies, PRISMA_DEPENDENCIES)
  ) {
    addDirectToolCommand(
      "schema-fast",
      "fast",
      "Prisma schema validation",
      "Prisma schema definitions should validate cleanly.",
      "prisma",
      ["validate", "--schema", "prisma/schema.prisma"],
    );
  }
  if (
    !catalog.some((command) => command.id === "schema-fast") &&
    files.has("schema.prisma") &&
    dependenciesIntersection(dependencies, PRISMA_DEPENDENCIES)
  ) {
    addDirectToolCommand(
      "schema-fast",
      "fast",
      "Prisma schema validation",
      "Prisma schema definitions should validate cleanly.",
      "prisma",
      ["validate", "--schema", "schema.prisma"],
    );
  }
  for (const script of ["test:unit", "unit", "test"]) {
    addScriptCommand(
      "unit-impact",
      "impact",
      "Unit tests",
      script,
      "Impacted unit tests should pass.",
    );
    if (catalog.some((command) => command.id === "unit-impact")) {
      break;
    }
  }
  for (const script of ["test:changed", "test:affected", "affected:test"]) {
    addScriptCommand(
      "changed-tests-impact",
      "impact",
      "Changed-area tests",
      script,
      "Changed-area tests should pass.",
    );
    if (catalog.some((command) => command.id === "changed-tests-impact")) {
      break;
    }
  }
  addScriptCommand(
    "build-impact",
    "impact",
    "Build",
    "build",
    "The project should build successfully after the patch.",
  );
  for (const script of [
    "migration:dry-run",
    "migrate:dry-run",
    "db:dry-run",
    "migration:status",
    "migrate:status",
    "prisma:migrate:status",
  ]) {
    addScriptCommand(
      "migration-impact",
      "impact",
      "Migration dry-run",
      script,
      "Migration planning or dry-run should succeed.",
    );
    if (catalog.some((command) => command.id === "migration-impact")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "migration-impact") &&
    files.has("prisma/migrations") &&
    dependenciesIntersection(dependencies, PRISMA_DEPENDENCIES)
  ) {
    const schemaPath = files.has("prisma/schema.prisma") ? "prisma/schema.prisma" : "schema.prisma";
    addDirectToolCommand(
      "migration-impact",
      "impact",
      "Prisma migration status",
      "Migration planning or dry-run should succeed.",
      "prisma",
      ["migrate", "status", "--schema", schemaPath],
    );
  }
  for (const script of [
    "e2e",
    "test:e2e",
    "playwright",
    "cypress",
    "visual",
    "test:visual",
    "test:smoke",
    "smoke",
  ]) {
    addScriptCommand(
      "e2e-deep",
      "deep",
      "End-to-end or visual checks",
      script,
      "Deep end-to-end or visual validation should pass.",
    );
    if (catalog.some((command) => command.id === "e2e-deep")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "e2e-deep") &&
    filesIntersection(files, ["playwright.config.ts", "playwright.config.js"]) &&
    dependenciesIntersection(dependencies, PLAYWRIGHT_DEPENDENCIES)
  ) {
    addDirectToolCommand(
      "e2e-deep",
      "deep",
      "Playwright end-to-end checks",
      "Deep end-to-end or visual validation should pass.",
      "playwright",
      ["test"],
    );
  }
  if (
    !catalog.some((command) => command.id === "e2e-deep") &&
    filesIntersection(files, ["cypress.config.ts", "cypress.config.js"]) &&
    dependenciesIntersection(dependencies, CYPRESS_DEPENDENCIES)
  ) {
    addDirectToolCommand(
      "e2e-deep",
      "deep",
      "Cypress end-to-end checks",
      "Deep end-to-end or visual validation should pass.",
      "cypress",
      ["run"],
    );
  }
  for (const script of ["test", "test:full", "test:ci", "ci:test", "verify", "check"]) {
    addScriptCommand(
      "full-suite-deep",
      "deep",
      "Full test suite",
      script,
      "The full test suite should pass before promotion.",
    );
    if (catalog.some((command) => command.id === "full-suite-deep")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "package-smoke-deep") &&
    (options.packageJson?.exports !== undefined ||
      options.packageJson?.main ||
      options.packageJson?.module ||
      options.packageJson?.types)
  ) {
    catalog.push({
      id: "package-smoke-deep",
      roundId: "deep",
      label: "Package tarball smoke",
      command: "node",
      args: [
        "-e",
        [
          "const { mkdtempSync, readdirSync, rmSync } = require('node:fs');",
          "const { spawnSync } = require('node:child_process');",
          "const { join } = require('node:path');",
          "const { tmpdir } = require('node:os');",
          "const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';",
          "const tempDir = mkdtempSync(join(tmpdir(), 'oraculum-pack-smoke-'));",
          "let exitCode = 0;",
          "try {",
          "  const result = spawnSync(npmBinary, ['pack', '--pack-destination', tempDir], { encoding: 'utf8', stdio: 'pipe' });",
          "  process.stdout.write(result.stdout || '');",
          "  process.stderr.write(result.stderr || '');",
          "  if ((result.status ?? 1) !== 0) {",
          "    exitCode = result.status ?? 1;",
          "  } else {",
          "    const tarballs = readdirSync(tempDir).filter((name) => name.endsWith('.tgz'));",
          "    if (tarballs.length === 0) { console.error('npm pack did not produce a tarball.'); exitCode = 1; }",
          "  }",
          "} finally {",
          "  rmSync(tempDir, { recursive: true, force: true });",
          "}",
          "if (exitCode !== 0) process.exit(exitCode);",
        ].join(" "),
      ],
      invariant: "The package should produce a real tarball before promotion.",
    });
  }
  for (const script of [
    "migration:rollback",
    "rollback:simulate",
    "rollback:simulation",
    "db:rollback:dry-run",
  ]) {
    addScriptCommand(
      "rollback-deep",
      "deep",
      "Rollback simulation",
      script,
      "Rollback simulation should succeed.",
    );
    if (catalog.some((command) => command.id === "rollback-deep")) {
      break;
    }
  }
  if (
    !catalog.some((command) => command.id === "migration-drift-deep") &&
    files.has("prisma/migrations") &&
    dependenciesIntersection(dependencies, PRISMA_DEPENDENCIES)
  ) {
    const schemaPath = files.has("prisma/schema.prisma") ? "prisma/schema.prisma" : "schema.prisma";
    addDirectToolCommand(
      "migration-drift-deep",
      "deep",
      "Prisma migration drift diff",
      "Migration history and the schema should stay aligned before promotion.",
      "prisma",
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema-datamodel",
        schemaPath,
        "--exit-code",
      ],
    );
  }
  if (
    options.packageJson?.exports !== undefined ||
    options.packageJson?.main ||
    options.packageJson?.module ||
    options.packageJson?.types
  ) {
    catalog.push({
      id: "pack-impact",
      roundId: "impact",
      label: "Package export check",
      command: "npm",
      args: ["pack", "--dry-run"],
      invariant: "The package should be packable for downstream consumers.",
    });
  }

  return catalog;
}

function buildScriptCommand(
  packageManager: ProfileRepoSignals["packageManager"],
  script: string,
): { command: string; args: string[] } | undefined {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: ["run", script] };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: [script] };
  }
  if (packageManager === "bun") {
    return { command: "bun", args: ["run", script] };
  }
  if (packageManager === "npm" || packageManager === "unknown") {
    return { command: "npm", args: ["run", script] };
  }
  return undefined;
}

function buildToolExecCommand(
  projectRoot: string,
  packageManager: ProfileRepoSignals["packageManager"],
  tool: string,
  args: string[],
): { command: string; args: string[] } | undefined {
  const pathTool = toolPathFinder(tool);
  if (pathTool) {
    return { command: pathTool, args };
  }
  const hasLocalTool = hasProjectLocalTool(projectRoot, tool);
  if (packageManager === "pnpm") {
    if (!hasLocalTool) {
      return undefined;
    }
    return { command: "pnpm", args: ["exec", tool, ...args] };
  }
  if (packageManager === "yarn") {
    if (!hasLocalTool) {
      return undefined;
    }
    return { command: "yarn", args: ["exec", tool, ...args] };
  }
  if (packageManager === "bun") {
    if (!hasLocalTool) {
      return undefined;
    }
    return { command: "bun", args: ["x", tool, ...args] };
  }
  if (packageManager === "npm" || packageManager === "unknown") {
    if (!hasLocalTool) {
      return undefined;
    }
    return { command: "npx", args: ["--no-install", tool, ...args] };
  }
  return undefined;
}

function hasProjectLocalTool(projectRoot: string, tool: string): boolean {
  const localBinDir = join(projectRoot, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? [
          join(localBinDir, `${tool}.cmd`),
          join(localBinDir, `${tool}.ps1`),
          join(localBinDir, tool),
        ]
      : [join(localBinDir, tool)];
  return candidates.some((candidate) => existsSync(candidate));
}

function findToolOnPath(tool: string): string | undefined {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = childProcess.spawnSync(locator, [tool], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if ((result.status ?? 1) !== 0) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function taskText(taskPacket: MaterializedTaskPacket): string {
  return [taskPacket.title, taskPacket.intent, ...taskPacket.oracleHints].join("\n");
}

function buildFallbackRecommendation(
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): AgentProfileRecommendation {
  const scores: Record<ConsultationProfileId, number> = {
    library: 0,
    frontend: 0,
    migration: 0,
  };

  if (signals.tags.includes("frontend-framework")) {
    scores.frontend += 4;
  }
  if (signals.tags.includes("frontend-build")) {
    scores.frontend += 2;
  }
  if (signals.tags.includes("e2e-config")) {
    scores.frontend += 1;
  }
  if (signals.tags.includes("task-frontend")) {
    scores.frontend += 2;
  }

  if (signals.tags.includes("migration-tooling")) {
    scores.migration += 4;
  }
  if (signals.tags.includes("migration-files")) {
    scores.migration += 3;
  }
  if (signals.tags.includes("migration-script")) {
    scores.migration += 2;
  }
  if (signals.tags.includes("task-migration")) {
    scores.migration += 2;
  }

  if (signals.tags.includes("package-export")) {
    scores.library += 3;
  }
  if (signals.tags.includes("library-signal")) {
    scores.library += 2;
  }
  if (signals.tags.includes("lint-script")) {
    scores.library += 1;
  }
  if (signals.tags.includes("typecheck-script")) {
    scores.library += 1;
  }

  const ranked = (Object.entries(scores) as Array<[ConsultationProfileId, number]>).sort(
    (left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return (
        PROFILE_FALLBACK_PRIORITY.indexOf(left[0]) - PROFILE_FALLBACK_PRIORITY.indexOf(right[0])
      );
    },
  );
  const chosenProfile = ranked[0]?.[0] ?? "library";
  const chosenScore = ranked[0]?.[1] ?? 0;
  const runnerUpScore = ranked[1]?.[1] ?? 0;
  const confidence =
    chosenScore >= 5 && chosenScore >= runnerUpScore + 2
      ? "high"
      : chosenScore >= 3
        ? "medium"
        : "low";

  const selectedCommandIds = chooseFallbackCommandIds(chosenProfile, signals.commandCatalog);
  const missingCapabilities = inferMissingCapabilities(chosenProfile, selectedCommandIds);

  return agentProfileRecommendationSchema.parse({
    profileId: chosenProfile,
    confidence,
    summary: buildFallbackSummary(chosenProfile, confidence, scores, signals, taskPacket),
    candidateCount: PROFILE_DEFAULT_CANDIDATES[chosenProfile],
    strategyIds: PROFILE_STRATEGIES[chosenProfile],
    selectedCommandIds,
    missingCapabilities,
  });
}

function buildFallbackSummary(
  profileId: ConsultationProfileId,
  confidence: AgentProfileRecommendation["confidence"],
  scores: Record<ConsultationProfileId, number>,
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): string {
  const topSignals = signals.tags.slice(0, 4).join(", ") || "no strong repo signals";
  const defaultedToLibrary =
    profileId === "library" && Object.values(scores).every((score) => score === 0);
  const rationale = defaultedToLibrary
    ? "defaulted to the safest library profile because no repo-specific signals were detected"
    : `detected ${profileId} consultation profile from repo/task signals (${topSignals})`;
  return `Fallback detection ${rationale}; confidence=${confidence}, scores=${JSON.stringify(scores)} for task "${basename(taskPacket.source.path)}".`;
}

function chooseFallbackCommandIds(
  profileId: ConsultationProfileId,
  catalog: ProfileCommandCandidate[],
): string[] {
  const availableIds = new Set(catalog.map((candidate) => candidate.id));
  const desiredByProfile: Record<ConsultationProfileId, string[]> = {
    library: [
      "lint-fast",
      "typecheck-fast",
      "unit-impact",
      "pack-impact",
      "full-suite-deep",
      "package-smoke-deep",
    ],
    frontend: ["lint-fast", "typecheck-fast", "changed-tests-impact", "build-impact", "e2e-deep"],
    migration: [
      "schema-fast",
      "lint-fast",
      "typecheck-fast",
      "migration-impact",
      "rollback-deep",
      "migration-drift-deep",
    ],
  };

  return desiredByProfile[profileId].filter((id) => availableIds.has(id));
}

function inferMissingCapabilities(
  profileId: ConsultationProfileId,
  selectedCommandIds: string[],
): string[] {
  const selected = new Set(selectedCommandIds);
  const missing: string[] = [];

  if (profileId === "library" && !selected.has("full-suite-deep")) {
    missing.push("No full-suite deep test command was detected.");
  }
  if (
    profileId === "library" &&
    !selected.has("package-smoke-deep") &&
    !selected.has("pack-impact")
  ) {
    missing.push("No package packaging smoke check was detected.");
  }
  if (profileId === "frontend" && !selected.has("build-impact")) {
    missing.push("No build validation command was detected.");
  }
  if (profileId === "frontend" && !selected.has("e2e-deep")) {
    missing.push("No e2e or visual deep check was detected.");
  }
  if (profileId === "migration" && !selected.has("schema-fast")) {
    missing.push("No schema validation command was detected.");
  }
  if (profileId === "migration" && !selected.has("migration-impact")) {
    missing.push("No migration planning or dry-run command was detected.");
  }
  if (
    profileId === "migration" &&
    !selected.has("rollback-deep") &&
    !selected.has("migration-drift-deep")
  ) {
    missing.push("No rollback simulation or migration drift deep check was detected.");
  }

  return missing;
}

function dependenciesIntersection(dependencies: Set<string>, expected: Set<string>): boolean {
  return [...expected].some((dependency) => dependencies.has(dependency));
}

function filesIntersection(files: Set<string>, expected: string[]): boolean {
  return expected.some((file) => files.has(file));
}

function sanitizeRecommendation(
  recommendation: AgentProfileRecommendation,
  signals: ProfileRepoSignals,
  fallback: AgentProfileRecommendation,
): AgentProfileRecommendation {
  const validCommandIds = new Set(signals.commandCatalog.map((command) => command.id));
  const filteredCommandIds = recommendation.selectedCommandIds.filter((id) =>
    validCommandIds.has(id),
  );
  const baselineCommandIds = chooseFallbackCommandIds(
    recommendation.profileId,
    signals.commandCatalog,
  );
  const selectedCommandIds = [...new Set([...baselineCommandIds, ...filteredCommandIds])];
  const validStrategyIds = new Set([
    "minimal-change",
    "safety-first",
    "test-amplified",
    "structural-refactor",
  ]);
  const filteredStrategyIds = recommendation.strategyIds.filter((id) => validStrategyIds.has(id));

  return agentProfileRecommendationSchema.parse({
    ...recommendation,
    candidateCount: clampCandidateCount(recommendation.candidateCount),
    strategyIds: filteredStrategyIds.length > 0 ? filteredStrategyIds : fallback.strategyIds,
    selectedCommandIds,
    missingCapabilities: inferMissingCapabilities(recommendation.profileId, selectedCommandIds),
  });
}

function clampCandidateCount(value: number): number {
  return Math.max(1, Math.min(16, Math.trunc(value)));
}

function resolveStrategyIds(baseConfig: ProjectConfig, requested: string[]): string[] {
  const available = new Set(baseConfig.strategies.map((strategy) => strategy.id));
  const filtered = requested.filter((id) => available.has(id));
  return filtered.length > 0 ? filtered : baseConfig.strategies.map((strategy) => strategy.id);
}

function buildGeneratedOracles(
  selectedCommandIds: string[],
  catalog: ProfileCommandCandidate[],
): RepoOracle[] {
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]));
  const oracles: RepoOracle[] = [];

  for (const commandId of selectedCommandIds) {
    const candidate = byId.get(commandId);
    if (!candidate) {
      continue;
    }

    oracles.push({
      id: candidate.id,
      roundId: candidate.roundId,
      command: candidate.command,
      args: candidate.args,
      invariant: candidate.invariant,
      cwd: "workspace",
      enforcement: "hard",
      confidence: candidate.roundId === "deep" ? "medium" : "high",
      env: {},
    });
  }

  return oracles;
}
