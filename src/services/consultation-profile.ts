import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";

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
import { collectExplicitCommandCatalog } from "./profile-explicit-command-collector.js";
import { collectProfileRepoFacts } from "./profile-repo-facts.js";
import { buildCapabilitySignals, buildSignalProvenance } from "./profile-signals.js";
import { type ProjectConfigLayers, writeJsonFile } from "./project.js";

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

interface ProfileCommandSlot {
  capability: string;
  roundId: ProfileCommandCandidate["roundId"];
}

// Fallback detection is intentionally conservative. A non-generic profile should only be
// auto-selected when a single profile has explicit, profile-specific anchor commands.
// Generic validation commands such as lint/typecheck/test should not silently masquerade as a
// library/frontend/migration intent when runtime profile selection is unavailable.
const PROFILE_FALLBACK_ANCHORS: Record<
  Exclude<ConsultationProfileId, "generic">,
  ProfileCommandSlot[]
> = {
  library: [
    { roundId: "impact", capability: "package-export-smoke" },
    { roundId: "deep", capability: "package-export-smoke" },
  ],
  frontend: [{ roundId: "deep", capability: "e2e-or-visual" }],
  migration: [
    { roundId: "fast", capability: "schema-validation" },
    { roundId: "impact", capability: "migration-dry-run" },
    { roundId: "deep", capability: "rollback-simulation" },
    { roundId: "deep", capability: "migration-drift" },
  ],
};

// These slot bundles are explicit product policy for generated oracle coverage after a profile is
// chosen. They are intentionally capability-level only; repository semantics still come from raw
// facts plus runtime profile selection rather than dependency-name heuristics.
const PROFILE_COMMAND_SLOTS: Record<ConsultationProfileId, ProfileCommandSlot[]> = {
  generic: [
    { roundId: "fast", capability: "lint" },
    { roundId: "fast", capability: "typecheck" },
    { roundId: "impact", capability: "changed-area-test" },
    { roundId: "impact", capability: "unit-test" },
    { roundId: "impact", capability: "build" },
    { roundId: "deep", capability: "full-suite-test" },
  ],
  library: [
    { roundId: "fast", capability: "lint" },
    { roundId: "fast", capability: "typecheck" },
    { roundId: "impact", capability: "unit-test" },
    { roundId: "impact", capability: "package-export-smoke" },
    { roundId: "deep", capability: "full-suite-test" },
    { roundId: "deep", capability: "package-export-smoke" },
  ],
  frontend: [
    { roundId: "fast", capability: "lint" },
    { roundId: "fast", capability: "typecheck" },
    { roundId: "impact", capability: "changed-area-test" },
    { roundId: "impact", capability: "build" },
    { roundId: "deep", capability: "e2e-or-visual" },
  ],
  migration: [
    { roundId: "fast", capability: "schema-validation" },
    { roundId: "fast", capability: "lint" },
    { roundId: "fast", capability: "typecheck" },
    { roundId: "impact", capability: "migration-dry-run" },
    { roundId: "deep", capability: "rollback-simulation" },
    { roundId: "deep", capability: "migration-drift" },
  ],
};

export async function recommendConsultationProfile(
  options: RecommendConsultationProfileOptions,
): Promise<RecommendedConsultationProfile> {
  const signals = await collectProfileRepoSignals(options.projectRoot, {
    rules: options.baseConfig.managedTree,
  });
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
      signals: buildSelectionSignalSummary(options.signals.capabilities),
    }),
  };
}

async function collectProfileRepoSignals(
  projectRoot: string,
  options: { rules: ProjectConfig["managedTree"] },
): Promise<ProfileRepoSignals> {
  const facts = await collectProfileRepoFacts(projectRoot, {
    rules: options.rules,
  });
  const capabilities = buildCapabilitySignals({
    files: facts.files,
    packageManagerEvidence: facts.packageManagerEvidence,
    packageJson: facts.packageJson,
    packageManager: facts.packageManager,
    scripts: facts.scripts,
    workspacePackageJsons: facts.workspacePackageJsons,
    workspaceRoots: facts.workspaceRoots,
  });
  const { commandCatalog: explicitCommandCatalog, skippedCommandCandidates: explicitSkipped } =
    await collectExplicitCommandCatalog({
      facts,
      projectRoot,
      rules: options.rules,
    });
  const { commandCatalog, skippedCommandCandidates } = buildCommandCatalog({
    capabilities,
    explicitCommandCatalog,
    explicitSkippedCommandCandidates: explicitSkipped,
    packageJson: facts.packageJson,
    packageManager: facts.packageManager,
    workspacePackageJsons: facts.workspacePackageJsons,
  });
  const provenance = buildSignalProvenance(capabilities);
  const notes = buildSignalNotes(
    capabilities,
    commandCatalog,
    facts.packageManager,
    facts.packageJson,
    facts.workspaceMetadata,
  );

  return profileRepoSignalsSchema.parse({
    packageManager: facts.packageManager,
    scripts: facts.scripts,
    dependencies: facts.dependencies,
    files: facts.files,
    workspaceRoots: facts.workspaceRoots,
    workspaceMetadata: facts.workspaceMetadata,
    notes,
    capabilities,
    provenance,
    commandCatalog,
    skippedCommandCandidates,
  });
}

function buildSignalNotes(
  capabilities: ProfileRepoSignals["capabilities"],
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
  workspaceMetadata: ProfileRepoSignals["workspaceMetadata"],
): string[] {
  const notes: string[] = [];
  if (
    capabilities.some(
      (capability) => capability.kind === "intent" && capability.value === "library",
    ) &&
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
      "No unambiguous lockfile or packageManager metadata was detected; package scripts were not auto-generated because the package manager is ambiguous.",
    );
  }
  if (!packageJson) {
    notes.push(
      workspaceMetadata.some((workspace) =>
        workspace.manifests.some((manifestPath) => manifestPath.endsWith("/package.json")),
      )
        ? "No root package.json was found; repository facts come from workspace manifests, files, and task context."
        : "No package.json was found; repository facts are limited to files and task context.",
    );
  }

  return notes;
}

function buildSelectionSignalSummary(
  capabilities: ProfileRepoSignals["capabilities"],
): ConsultationProfileSelection["signals"] {
  return capabilities.map((capability) => `${capability.kind}:${capability.value}`);
}

function buildFallbackRecommendation(
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): AgentProfileRecommendation {
  const commandSlots = new Set(signals.commandCatalog.map(commandSlotKey));
  const anchoredProfiles = (
    Object.entries(PROFILE_FALLBACK_ANCHORS) as Array<
      [Exclude<ConsultationProfileId, "generic">, ProfileCommandSlot[]]
    >
  )
    .filter(([, anchors]) => anchors.some((anchor) => commandSlots.has(commandSlotKey(anchor))))
    .map(([profileId]) => profileId);
  const [anchoredProfile] = anchoredProfiles;
  const chosenProfile: ConsultationProfileId =
    anchoredProfiles.length === 1 && anchoredProfile ? anchoredProfile : "generic";
  const confidence =
    anchoredProfiles.length === 1 ? "high" : commandSlots.size > 0 ? "medium" : "low";

  const selectedCommandIds = chooseFallbackCommandIds(
    chosenProfile === "generic" && anchoredProfiles.length > 1
      ? ["generic", ...anchoredProfiles]
      : [chosenProfile],
    signals.commandCatalog,
  );
  const missingCapabilities = inferMissingCapabilities(
    chosenProfile,
    selectedCommandIds,
    signals.commandCatalog,
  );

  return agentProfileRecommendationSchema.parse({
    profileId: chosenProfile,
    confidence,
    summary: buildFallbackSummary(chosenProfile, confidence, anchoredProfiles, signals, taskPacket),
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
  anchoredProfiles: Array<Exclude<ConsultationProfileId, "generic">>,
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): string {
  const topCommandIds =
    signals.commandCatalog
      .map((command) => command.id)
      .slice(0, 4)
      .join(", ") || "no executable command evidence";
  const rationale =
    profileId !== "generic"
      ? `detected a unique ${profileId} profile anchor from executable command evidence (${topCommandIds})`
      : anchoredProfiles.length > 1
        ? `defaulted to the generic profile because profile-specific anchors conflicted (${anchoredProfiles.join(", ")})`
        : "defaulted to the generic profile because no executable profile-specific anchor was detected";
  return `Fallback detection ${rationale}; confidence=${confidence} for task "${basename(taskPacket.source.path)}".`;
}

function chooseFallbackCommandIds(
  profileIds: ConsultationProfileId[],
  catalog: ProfileCommandCandidate[],
): string[] {
  const selectedCommandIds: string[] = [];
  const usedExecutionKeys = new Set<string>();

  for (const profileId of profileIds) {
    for (const desiredSlot of PROFILE_COMMAND_SLOTS[profileId]) {
      const candidate = catalog.find((command) => {
        const executionKey = commandExecutionKey(command);
        return (
          command.roundId === desiredSlot.roundId &&
          command.capability === desiredSlot.capability &&
          !usedExecutionKeys.has(executionKey)
        );
      });
      if (!candidate) {
        continue;
      }

      selectedCommandIds.push(candidate.id);
      usedExecutionKeys.add(commandExecutionKey(candidate));
    }
  }

  return selectedCommandIds;
}

function inferMissingCapabilities(
  profileId: ConsultationProfileId,
  selectedCommandIds: string[],
  catalog: ProfileCommandCandidate[],
): string[] {
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]));
  const selectedCommands = selectedCommandIds.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [candidate] : [];
  });
  const selectedSlots = new Set(
    selectedCommands.flatMap((candidate) =>
      candidate.capability ? [commandSlotKey(candidate)] : [],
    ),
  );
  const selectedExecutionKeys = new Set(selectedCommands.map(commandExecutionKey));
  const hasSelectedSlot = (slot: ProfileCommandSlot) =>
    selectedSlots.has(commandSlotKey(slot)) ||
    catalog.some(
      (candidate) =>
        candidate.roundId === slot.roundId &&
        candidate.capability === slot.capability &&
        selectedExecutionKeys.has(commandExecutionKey(candidate)),
    );
  const missing: string[] = [];

  if (profileId === "generic" && selectedSlots.size === 0) {
    missing.push("No repo-local validation command was detected.");
  }
  if (
    profileId === "library" &&
    !hasSelectedSlot({ roundId: "deep", capability: "full-suite-test" })
  ) {
    missing.push("No full-suite deep test command was detected.");
  }
  if (
    profileId === "library" &&
    !hasSelectedSlot({ roundId: "deep", capability: "package-export-smoke" }) &&
    !hasSelectedSlot({ roundId: "impact", capability: "package-export-smoke" })
  ) {
    missing.push("No package packaging smoke check was detected.");
  }
  if (profileId === "frontend" && !hasSelectedSlot({ roundId: "impact", capability: "build" })) {
    missing.push("No build validation command was detected.");
  }
  if (
    profileId === "frontend" &&
    !hasSelectedSlot({ roundId: "deep", capability: "e2e-or-visual" })
  ) {
    missing.push("No e2e or visual deep check was detected.");
  }
  if (
    profileId === "migration" &&
    !hasSelectedSlot({ roundId: "fast", capability: "schema-validation" })
  ) {
    missing.push("No schema validation command was detected.");
  }
  if (
    profileId === "migration" &&
    !hasSelectedSlot({ roundId: "impact", capability: "migration-dry-run" })
  ) {
    missing.push("No migration planning or dry-run command was detected.");
  }
  if (
    profileId === "migration" &&
    !hasSelectedSlot({ roundId: "deep", capability: "rollback-simulation" }) &&
    !hasSelectedSlot({ roundId: "deep", capability: "migration-drift" })
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
    [recommendation.profileId],
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
    missingCapabilities: inferMissingCapabilities(
      recommendation.profileId,
      selectedCommandIds,
      signals.commandCatalog,
    ),
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

    const commandKey = commandExecutionKey(candidate);
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
      ...(candidate.relativeCwd ? { relativeCwd: candidate.relativeCwd } : {}),
      pathPolicy: candidate.pathPolicy ?? "local-only",
      enforcement: "hard",
      confidence: candidate.roundId === "deep" ? "medium" : "high",
      timeoutMs: GENERATED_ORACLE_TIMEOUT_MS[candidate.roundId],
      ...(candidate.safetyRationale ? { safetyRationale: candidate.safetyRationale } : {}),
      env: {},
    });
  }

  return oracles;
}

function commandSlotKey(slot: {
  capability?: string | undefined;
  roundId: ProfileCommandCandidate["roundId"];
}): string {
  return `${slot.roundId}:${slot.capability ?? "unknown"}`;
}

function commandExecutionKey(candidate: ProfileCommandCandidate): string {
  return (
    candidate.dedupeKey ??
    JSON.stringify([
      candidate.command,
      candidate.args,
      candidate.relativeCwd ?? "",
      candidate.pathPolicy ?? "local-only",
    ])
  );
}
