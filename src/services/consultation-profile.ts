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

import { buildCommandCatalog, hasCapabilityCommand } from "./profile-command-catalog.js";
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
  signals?: ProfileRepoSignals;
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

const GENERATED_ORACLE_TIMEOUT_MS = {
  fast: 60_000,
  impact: 5 * 60_000,
  deep: 10 * 60_000,
} as const satisfies Record<ProfileCommandCandidate["roundId"], number>;

const FALLBACK_STRATEGY_IDS: ProfileStrategyId[] = ["minimal-change", "safety-first"];
const FALLBACK_DEFAULT_CANDIDATE_COUNT = defaultProjectConfig.defaultCandidates;
const FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT = Math.min(3, FALLBACK_DEFAULT_CANDIDATE_COUNT);

interface ProfileCommandSlot {
  capability: string;
  roundId: ProfileCommandCandidate["roundId"];
}

interface MissingCapabilityRule {
  runtimeEvidencePredicate?: (context: {
    capabilities: ProfileRepoSignals["capabilities"];
    hasCatalogEvidence: boolean;
    hasCapabilitySignal: (
      predicate: (capability: ProfileRepoSignals["capabilities"][number]) => boolean,
    ) => boolean;
    hasSkippedEvidence: boolean;
  }) => boolean;
  slots: ProfileCommandSlot[];
  whenDetectedButNotSelected: string;
  whenNotDetected: string;
}

// Fallback detection is intentionally conservative. A non-generic profile should only be
// auto-selected when a single profile has explicit, profile-specific anchor commands.
// Generic validation commands such as lint/typecheck/test should not silently masquerade as a
// library/frontend/migration intent when runtime profile selection is unavailable.
// Package export smoke remains review evidence, but it is product-owned today rather than an
// explicit repo-local executable anchor, so fallback detection must not auto-select `library`.
type FallbackAnchoredProfileId = "frontend" | "migration";
type FallbackDetectedProfileId = "generic" | FallbackAnchoredProfileId;

const PROFILE_FALLBACK_ANCHORS: Record<FallbackAnchoredProfileId, ProfileCommandSlot[]> = {
  frontend: [{ roundId: "deep", capability: "e2e-or-visual" }],
  migration: [
    { roundId: "fast", capability: "schema-validation" },
    { roundId: "impact", capability: "migration-dry-run" },
    { roundId: "deep", capability: "rollback-simulation" },
    { roundId: "deep", capability: "migration-drift" },
  ],
};

// This baseline is only for conservative fallback oracle selection when runtime profile selection
// is unavailable. Profile-specific fallback pressure comes only from explicit anchor slots.
const FALLBACK_BASELINE_COMMAND_SLOTS: ProfileCommandSlot[] = [
  { roundId: "fast", capability: "lint" },
  { roundId: "fast", capability: "typecheck" },
  { roundId: "impact", capability: "changed-area-test" },
  { roundId: "impact", capability: "unit-test" },
  { roundId: "impact", capability: "build" },
  { roundId: "deep", capability: "full-suite-test" },
];

const PROFILE_MISSING_CAPABILITY_RULES: Record<
  Exclude<ConsultationProfileId, "generic">,
  MissingCapabilityRule[]
> = {
  library: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal, hasSkippedEvidence }) =>
        hasCatalogEvidence ||
        hasSkippedEvidence ||
        hasCapabilitySignal((capability) => capability.kind === "test-runner"),
      slots: [{ roundId: "deep", capability: "full-suite-test" }],
      whenDetectedButNotSelected: "No full-suite deep test command was selected.",
      whenNotDetected: "No full-suite deep test command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [
        { roundId: "deep", capability: "package-export-smoke" },
        { roundId: "impact", capability: "package-export-smoke" },
      ],
      whenDetectedButNotSelected: "No package packaging smoke check was selected.",
      whenNotDetected: "No package packaging smoke check was detected.",
    },
  ],
  frontend: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal }) =>
        hasCatalogEvidence ||
        hasCapabilitySignal(
          (capability) =>
            (capability.kind === "build-system" && capability.value === "frontend-config") ||
            (capability.kind === "command" && capability.value === "build"),
        ),
      slots: [{ roundId: "impact", capability: "build" }],
      whenDetectedButNotSelected: "No build validation command was selected.",
      whenNotDetected: "No build validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal, hasSkippedEvidence }) =>
        hasCatalogEvidence ||
        hasSkippedEvidence ||
        hasCapabilitySignal(
          (capability) =>
            capability.kind === "test-runner" &&
            (capability.value === "playwright" || capability.value === "cypress"),
        ),
      slots: [{ roundId: "deep", capability: "e2e-or-visual" }],
      whenDetectedButNotSelected: "No e2e or visual deep check was selected.",
      whenNotDetected: "No e2e or visual deep check was detected.",
    },
  ],
  migration: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal, hasSkippedEvidence }) =>
        hasCatalogEvidence ||
        hasSkippedEvidence ||
        hasCapabilitySignal((capability) => capability.kind === "migration-tool"),
      slots: [{ roundId: "fast", capability: "schema-validation" }],
      whenDetectedButNotSelected: "No schema validation command was selected.",
      whenNotDetected: "No schema validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal, hasSkippedEvidence }) =>
        hasCatalogEvidence ||
        hasSkippedEvidence ||
        hasCapabilitySignal((capability) => capability.kind === "migration-tool"),
      slots: [{ roundId: "impact", capability: "migration-dry-run" }],
      whenDetectedButNotSelected: "No migration planning or dry-run command was selected.",
      whenNotDetected: "No migration planning or dry-run command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasCapabilitySignal, hasSkippedEvidence }) =>
        hasCatalogEvidence ||
        hasSkippedEvidence ||
        hasCapabilitySignal((capability) => capability.kind === "migration-tool"),
      slots: [
        { roundId: "deep", capability: "rollback-simulation" },
        { roundId: "deep", capability: "migration-drift" },
      ],
      whenDetectedButNotSelected:
        "No rollback simulation or migration drift deep check was selected.",
      whenNotDetected: "No rollback simulation or migration drift deep check was detected.",
    },
  ],
};

export async function recommendConsultationProfile(
  options: RecommendConsultationProfileOptions,
): Promise<RecommendedConsultationProfile> {
  const signals =
    options.signals ??
    (await collectProfileRepoSignals(options.projectRoot, {
      rules: options.baseConfig.managedTree,
    }));
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

export async function collectProfileRepoSignals(
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
    !hasCapabilityCommand(commandCatalog, "package-export-smoke", ["impact", "deep"])
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
  const commandSlots = new Set(
    signals.commandCatalog
      .filter((command) => command.source === "repo-local-script")
      .map(commandSlotKey),
  );
  const anchoredProfiles = (
    Object.entries(PROFILE_FALLBACK_ANCHORS) as Array<
      [FallbackAnchoredProfileId, ProfileCommandSlot[]]
    >
  )
    .filter(([, anchors]) => anchors.some((anchor) => commandSlots.has(commandSlotKey(anchor))))
    .map(([profileId]) => profileId);
  const [anchoredProfile] = anchoredProfiles;
  const chosenProfile: FallbackDetectedProfileId =
    anchoredProfiles.length === 1 && anchoredProfile ? anchoredProfile : "generic";
  const confidence =
    anchoredProfiles.length === 1 ? "high" : commandSlots.size > 0 ? "medium" : "low";

  const selectedCommandIds = chooseFallbackCommandIds(
    buildFallbackCommandSlots(chosenProfile),
    signals.commandCatalog,
  );
  const missingCapabilities = inferMissingCapabilities(
    chosenProfile,
    selectedCommandIds,
    signals.commandCatalog,
    signals.capabilities,
    signals.skippedCommandCandidates,
  );

  return agentProfileRecommendationSchema.parse({
    profileId: chosenProfile,
    confidence,
    summary: buildFallbackSummary(chosenProfile, confidence, anchoredProfiles, signals, taskPacket),
    candidateCount:
      confidence === "low"
        ? FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT
        : FALLBACK_DEFAULT_CANDIDATE_COUNT,
    strategyIds: FALLBACK_STRATEGY_IDS,
    selectedCommandIds,
    missingCapabilities,
  });
}

function buildFallbackSummary(
  profileId: FallbackDetectedProfileId,
  confidence: AgentProfileRecommendation["confidence"],
  anchoredProfiles: FallbackAnchoredProfileId[],
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): string {
  const topCommandIds =
    signals.commandCatalog
      .filter((command) => command.source === "repo-local-script")
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

function buildFallbackCommandSlots(profileId: FallbackDetectedProfileId): ProfileCommandSlot[] {
  const profileAnchors = profileId === "generic" ? [] : PROFILE_FALLBACK_ANCHORS[profileId];
  const slots =
    profileId === "generic"
      ? FALLBACK_BASELINE_COMMAND_SLOTS
      : [...FALLBACK_BASELINE_COMMAND_SLOTS, ...profileAnchors];
  const seen = new Set<string>();

  return slots.filter((slot) => {
    const key = commandSlotKey(slot);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function chooseFallbackCommandIds(
  desiredSlots: ProfileCommandSlot[],
  catalog: ProfileCommandCandidate[],
): string[] {
  const selectedCommandIds: string[] = [];
  const usedExecutionKeys = new Set<string>();

  for (const desiredSlot of desiredSlots) {
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

  return selectedCommandIds;
}

function inferMissingCapabilities(
  profileId: ConsultationProfileId,
  selectedCommandIds: string[],
  catalog: ProfileCommandCandidate[],
  capabilities: ProfileRepoSignals["capabilities"],
  skippedCommandCandidates: ProfileRepoSignals["skippedCommandCandidates"],
  requireRuntimeEvidence = false,
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
  const hasCatalogSlot = (slot: ProfileCommandSlot) =>
    catalog.some(
      (candidate) => candidate.roundId === slot.roundId && candidate.capability === slot.capability,
    );
  const hasSkippedCapability = (capability: string) =>
    skippedCommandCandidates.some((candidate) => candidate.capability === capability);
  const hasCapabilitySignal = (
    predicate: (capability: ProfileRepoSignals["capabilities"][number]) => boolean,
  ) => capabilities.some(predicate);
  const recordMissing = (options: {
    slots: ProfileCommandSlot[];
    whenDetectedButNotSelected: string;
    whenNotDetected: string;
  }) => {
    if (options.slots.some(hasSelectedSlot)) {
      return;
    }
    missing.push(
      options.slots.some(hasCatalogSlot)
        ? options.whenDetectedButNotSelected
        : options.whenNotDetected,
    );
  };
  const missing: string[] = [];

  if (profileId === "generic" && selectedSlots.size === 0) {
    const hasRepoLocalValidationCommand = catalog.some(
      (candidate) => candidate.source === "repo-local-script",
    );
    missing.push(
      hasRepoLocalValidationCommand
        ? "No repo-local validation command was selected."
        : "No repo-local validation command was detected.",
    );
  }
  if (profileId !== "generic") {
    for (const rule of PROFILE_MISSING_CAPABILITY_RULES[profileId]) {
      const hasCatalogEvidence = rule.slots.some(hasCatalogSlot);
      const hasSkippedEvidence = rule.slots.some((slot) => hasSkippedCapability(slot.capability));
      if (
        requireRuntimeEvidence &&
        rule.runtimeEvidencePredicate &&
        !rule.runtimeEvidencePredicate({
          capabilities,
          hasCatalogEvidence,
          hasCapabilitySignal,
          hasSkippedEvidence,
        })
      ) {
        continue;
      }
      recordMissing(rule);
    }
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
  const selectedCommandIds = [...new Set(filteredCommandIds)];
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
      signals.capabilities,
      signals.skippedCommandCandidates,
      true,
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
