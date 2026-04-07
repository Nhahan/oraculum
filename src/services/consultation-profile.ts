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

const PROFILE_DESCRIPTIONS: Record<ConsultationProfileId, string> = {
  library:
    "Package or shared library work. Favor lint/typecheck, unit tests, and package/export evidence.",
  frontend:
    "User-facing frontend work. Favor lint/typecheck, build, changed-area tests, and e2e/visual checks when available.",
  migration:
    "Schema or migration work. Favor schema validation, migration dry-runs, rollback simulation, and conservative strategies.",
};

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
      missingCapabilities: options.recommendation.missingCapabilities,
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
    packageJson,
    packageManager,
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
    commandCatalog.every((command) => command.id !== "pack-impact")
  ) {
    notes.push(
      "Package export signals were detected, but no safe package export check was auto-generated.",
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
  scripts: string[];
}): ProfileCommandCandidate[] {
  const scripts = new Set(options.scripts);
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
  for (const script of ["e2e", "test:e2e", "playwright", "cypress", "visual", "test:visual"]) {
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
  if (scripts.has("test") && !catalog.some((command) => command.id === "full-suite-deep")) {
    const command = buildScriptCommand(options.packageManager, "test");
    if (command) {
      catalog.push({
        id: "full-suite-deep",
        roundId: "deep",
        label: "Full test suite",
        command: command.command,
        args: command.args,
        invariant: "The full test suite should pass before promotion.",
      });
    }
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
    options.packageManager === "npm" &&
    (options.packageJson?.exports !== undefined ||
      options.packageJson?.main ||
      options.packageJson?.module ||
      options.packageJson?.types)
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
      return left[0].localeCompare(right[0]);
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
  return `Detected ${profileId} consultation profile from repo/task signals (${topSignals}); fallback confidence=${confidence}, scores=${JSON.stringify(scores)} for task "${basename(taskPacket.source.path)}".`;
}

function chooseFallbackCommandIds(
  profileId: ConsultationProfileId,
  catalog: ProfileCommandCandidate[],
): string[] {
  const availableIds = new Set(catalog.map((candidate) => candidate.id));
  const desiredByProfile: Record<ConsultationProfileId, string[]> = {
    library: ["lint-fast", "typecheck-fast", "unit-impact", "pack-impact", "full-suite-deep"],
    frontend: ["lint-fast", "typecheck-fast", "changed-tests-impact", "build-impact", "e2e-deep"],
    migration: ["schema-fast", "lint-fast", "typecheck-fast", "migration-impact", "rollback-deep"],
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
  if (profileId === "frontend" && !selected.has("e2e-deep")) {
    missing.push("No e2e or visual deep check was detected.");
  }
  if (profileId === "migration" && !selected.has("rollback-deep")) {
    missing.push("No rollback simulation was detected.");
  }

  return missing;
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
    selectedCommandIds: filteredCommandIds,
    missingCapabilities: recommendation.missingCapabilities,
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
