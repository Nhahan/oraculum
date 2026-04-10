import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AgentAdapter } from "../adapters/types.js";
import { getProfileSelectionPath } from "../core/paths.js";
import {
  defaultProjectConfig,
  type ProjectConfig,
  projectConfigSchema,
  type RepoOracle,
} from "../domain/config.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
  type ConsultationProfileId,
  type ConsultationProfileSelection,
  consultationProfileSelectionSchema,
  type ProfileCommandCandidate,
  type ProfileRepoSignals,
  type ProfileStrategyId,
  profileRepoSignalsSchema,
  profileStrategyIds,
} from "../domain/profile.js";
import type { MaterializedTaskPacket } from "../domain/task.js";

import { buildCommandCatalog } from "./profile-command-catalog.js";
import {
  buildCapabilitySignals,
  buildLegacySignalTags,
  buildSignalProvenance,
  detectKnownFiles,
  detectWorkspaceRoots,
} from "./profile-signals.js";
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
  generic:
    "General-purpose work when repository signals are weak or ecosystem-specific checks are not safely detectable.",
  library:
    "Package or shared library work. Favor lint/typecheck, unit tests, and package/export evidence.",
  frontend:
    "User-facing frontend work. Favor lint/typecheck, build, changed-area tests, and e2e/visual checks when available.",
  migration:
    "Schema or migration work. Favor schema validation, migration dry-runs, rollback simulation, and conservative strategies.",
};

const PROFILE_DEFAULT_CANDIDATES: Record<ConsultationProfileId, number> = {
  generic: 3,
  library: 4,
  frontend: 4,
  migration: 3,
};

const GENERATED_ORACLE_TIMEOUT_MS = {
  fast: 60_000,
  impact: 5 * 60_000,
  deep: 10 * 60_000,
} as const satisfies Record<ProfileCommandCandidate["roundId"], number>;

const PROFILE_STRATEGIES: Record<ConsultationProfileId, ProfileStrategyId[]> = {
  generic: ["minimal-change", "safety-first"],
  library: ["minimal-change", "test-amplified", "safety-first"],
  frontend: ["minimal-change", "safety-first", "test-amplified"],
  migration: ["safety-first", "structural-refactor", "minimal-change"],
};

const PROFILE_FALLBACK_PRIORITY: ConsultationProfileId[] = [
  "library",
  "frontend",
  "migration",
  "generic",
];

export async function recommendConsultationProfile(
  options: RecommendConsultationProfileOptions,
): Promise<RecommendedConsultationProfile> {
  const signals = await collectProfileRepoSignals(options.projectRoot);
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
    (options.configLayers.quick.defaultCandidates !== undefined &&
      options.configLayers.quick.defaultCandidates !== defaultProjectConfig.defaultCandidates);
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

async function collectProfileRepoSignals(projectRoot: string): Promise<ProfileRepoSignals> {
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

  const workspaceRoots = await detectWorkspaceRoots(projectRoot);
  const knownFiles = await detectKnownFiles(projectRoot, workspaceRoots);
  const tags = buildLegacySignalTags({
    dependencies,
    files: knownFiles,
    packageJson,
    scripts,
  });
  const commandCatalog = buildCommandCatalog({
    packageJson,
    packageManager,
    scripts,
  });
  const capabilities = buildCapabilitySignals({
    dependencies,
    files: knownFiles,
    packageJson,
    packageManager,
    scripts,
    tags,
    workspaceRoots,
  });
  const provenance = buildSignalProvenance(tags, capabilities);
  const notes = buildSignalNotes(tags, commandCatalog, packageManager, packageJson);

  return profileRepoSignalsSchema.parse({
    packageManager,
    scripts,
    dependencies,
    files: knownFiles,
    workspaceRoots,
    tags,
    notes,
    capabilities,
    provenance,
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
      "No lockfile or packageManager field was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
  }
  if (!packageJson) {
    notes.push(
      "No package.json was found; repository facts are limited to files and task context.",
    );
  }

  return notes;
}

function buildFallbackRecommendation(
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): AgentProfileRecommendation {
  const scores: Record<ConsultationProfileId, number> = {
    generic: 0,
    library: 0,
    frontend: 0,
    migration: 0,
  };
  const commandIds = new Set(signals.commandCatalog.map((command) => command.id));

  if (commandIds.has("package-smoke-deep") || commandIds.has("pack-impact")) {
    scores.library += 5;
  }
  if (commandIds.has("unit-impact") || commandIds.has("full-suite-deep")) {
    scores.library += 1;
  }
  if (commandIds.has("e2e-deep")) {
    scores.frontend += 5;
  }
  if (
    commandIds.has("schema-fast") ||
    commandIds.has("migration-impact") ||
    commandIds.has("rollback-deep")
  ) {
    scores.migration += 5;
  }

  const rankedProfiles = (Object.entries(scores) as Array<[ConsultationProfileId, number]>).sort(
    (left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return (
        PROFILE_FALLBACK_PRIORITY.indexOf(left[0]) - PROFILE_FALLBACK_PRIORITY.indexOf(right[0])
      );
    },
  );
  const hasProfileSignal = scores.library > 0 || scores.frontend > 0 || scores.migration > 0;
  const ranked: Array<[ConsultationProfileId, number]> = hasProfileSignal
    ? rankedProfiles
    : [["generic", 0]];
  const chosenProfile = ranked[0]?.[0] ?? "generic";
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
    candidateCount:
      confidence === "low"
        ? Math.min(3, PROFILE_DEFAULT_CANDIDATES[chosenProfile])
        : PROFILE_DEFAULT_CANDIDATES[chosenProfile],
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
  const topCommandIds =
    signals.commandCatalog
      .map((command) => command.id)
      .slice(0, 4)
      .join(", ") || "no executable command evidence";
  const defaultedToGeneric =
    profileId === "generic" &&
    scores.library === 0 &&
    scores.frontend === 0 &&
    scores.migration === 0;
  const rationale = defaultedToGeneric
    ? "defaulted to the generic profile because no executable profile-specific command evidence was detected"
    : `detected ${profileId} consultation profile from executable command evidence (${topCommandIds})`;
  return `Fallback detection ${rationale}; confidence=${confidence}, scores=${JSON.stringify(scores)} for task "${basename(taskPacket.source.path)}".`;
}

function chooseFallbackCommandIds(
  profileId: ConsultationProfileId,
  catalog: ProfileCommandCandidate[],
): string[] {
  const availableIds = new Set(catalog.map((candidate) => candidate.id));
  const desiredByProfile: Record<ConsultationProfileId, string[]> = {
    generic: [
      "lint-fast",
      "typecheck-fast",
      "changed-tests-impact",
      "unit-impact",
      "build-impact",
      "full-suite-deep",
    ],
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

  if (profileId === "generic" && selected.size === 0) {
    missing.push("No repo-local validation command was detected.");
  }
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
  const validStrategyIds = new Set(profileStrategyIds);
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

  const seenCommands = new Set<string>();
  for (const commandId of selectedCommandIds) {
    const candidate = byId.get(commandId);
    if (!candidate) {
      continue;
    }

    const commandKey = JSON.stringify([candidate.command, candidate.args]);
    if (seenCommands.has(commandKey)) {
      continue;
    }
    seenCommands.add(commandKey);

    oracles.push({
      id: candidate.id,
      roundId: candidate.roundId,
      command: candidate.command,
      args: candidate.args,
      invariant: candidate.invariant,
      cwd: "workspace",
      enforcement: "hard",
      confidence: candidate.roundId === "deep" ? "medium" : "high",
      timeoutMs: GENERATED_ORACLE_TIMEOUT_MS[candidate.roundId],
      env: {},
    });
  }

  return oracles;
}
