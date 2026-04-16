import { basename } from "node:path";

import { defaultProjectConfig } from "../../domain/config.js";
import type {
  AgentProfileRecommendation,
  ConsultationProfileId,
  ProfileRepoSignals,
} from "../../domain/profile.js";
import {
  agentProfileRecommendationSchema,
  isSupportedConsultationProfileId,
  profileStrategyIds,
} from "../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

import {
  clampCandidateCount,
  commandExecutionKey,
  commandSlotKey,
  FALLBACK_STRATEGY_IDS,
  type FallbackAnchoredProfileId,
  type FallbackDetectedProfileId,
  type MissingCapabilityRule,
  type ProfileCommandSlot,
} from "./shared.js";

const FALLBACK_DEFAULT_CANDIDATE_COUNT = defaultProjectConfig.defaultCandidates;
const FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT = Math.min(3, FALLBACK_DEFAULT_CANDIDATE_COUNT);

const VALIDATION_POSTURE_FALLBACK_ANCHORS: Record<FallbackAnchoredProfileId, ProfileCommandSlot[]> =
  {
    frontend: [{ roundId: "deep", capability: "e2e-or-visual" }],
    migration: [
      { roundId: "fast", capability: "schema-validation" },
      { roundId: "impact", capability: "migration-dry-run" },
      { roundId: "deep", capability: "rollback-simulation" },
      { roundId: "deep", capability: "migration-drift" },
    ],
  };

const FALLBACK_BASELINE_COMMAND_SLOTS: ProfileCommandSlot[] = [
  { roundId: "fast", capability: "lint" },
  { roundId: "fast", capability: "typecheck" },
  { roundId: "impact", capability: "changed-area-test" },
  { roundId: "impact", capability: "unit-test" },
  { roundId: "impact", capability: "build" },
  { roundId: "deep", capability: "full-suite-test" },
];

const VALIDATION_POSTURE_MISSING_CAPABILITY_RULES: Record<
  Exclude<ConsultationProfileId, "generic">,
  MissingCapabilityRule[]
> = {
  library: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
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
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "impact", capability: "build" }],
      whenDetectedButNotSelected: "No build validation command was selected.",
      whenNotDetected: "No build validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "deep", capability: "e2e-or-visual" }],
      whenDetectedButNotSelected: "No e2e or visual deep check was selected.",
      whenNotDetected: "No e2e or visual deep check was detected.",
    },
  ],
  migration: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "fast", capability: "schema-validation" }],
      whenDetectedButNotSelected: "No schema validation command was selected.",
      whenNotDetected: "No schema validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "impact", capability: "migration-dry-run" }],
      whenDetectedButNotSelected: "No migration planning or dry-run command was selected.",
      whenNotDetected: "No migration planning or dry-run command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
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

export function buildFallbackRecommendation(
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): AgentProfileRecommendation {
  const commandSlots = new Set(
    signals.commandCatalog
      .filter((command) => command.source === "repo-local-script")
      .map(commandSlotKey),
  );
  const anchoredProfiles = (
    Object.entries(VALIDATION_POSTURE_FALLBACK_ANCHORS) as Array<
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
    validationProfileId: chosenProfile,
    confidence,
    validationSummary: buildFallbackSummary(
      chosenProfile,
      confidence,
      anchoredProfiles,
      signals,
      taskPacket,
    ),
    candidateCount:
      confidence === "low"
        ? FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT
        : FALLBACK_DEFAULT_CANDIDATE_COUNT,
    strategyIds: FALLBACK_STRATEGY_IDS,
    selectedCommandIds,
    validationGaps: missingCapabilities,
  });
}

export function sanitizeRecommendation(
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
  const validationProfileId = recommendation.validationProfileId;
  if (!isSupportedConsultationProfileId(validationProfileId)) {
    return fallback;
  }
  const validationSummary = recommendation.validationSummary;
  const validationGaps = inferMissingCapabilities(
    validationProfileId,
    selectedCommandIds,
    signals.commandCatalog,
    signals.capabilities,
    signals.skippedCommandCandidates,
    true,
  );

  return agentProfileRecommendationSchema.parse({
    validationProfileId,
    candidateCount: clampCandidateCount(recommendation.candidateCount),
    strategyIds: filteredStrategyIds.length > 0 ? filteredStrategyIds : fallback.strategyIds,
    confidence: recommendation.confidence,
    validationSummary,
    selectedCommandIds,
    validationGaps,
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
      ? `detected a unique ${profileId} validation posture anchor from executable command evidence (${topCommandIds})`
      : anchoredProfiles.length > 1
        ? `defaulted to the generic validation posture because posture-specific validation anchors conflicted (${anchoredProfiles.join(", ")})`
        : "defaulted to the generic validation posture because no executable posture-specific validation anchor was detected";
  return `Fallback detection ${rationale}; confidence=${confidence} for task "${basename(taskPacket.source.path)}".`;
}

function buildFallbackCommandSlots(profileId: FallbackDetectedProfileId): ProfileCommandSlot[] {
  const profileAnchors =
    profileId === "generic" ? [] : VALIDATION_POSTURE_FALLBACK_ANCHORS[profileId];
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
  catalog: ProfileRepoSignals["commandCatalog"],
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
  catalog: ProfileRepoSignals["commandCatalog"],
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
    for (const rule of VALIDATION_POSTURE_MISSING_CAPABILITY_RULES[profileId]) {
      const hasCatalogEvidence = rule.slots.some(hasCatalogSlot);
      const hasSkippedEvidence = rule.slots.some((slot) => hasSkippedCapability(slot.capability));
      if (
        requireRuntimeEvidence &&
        rule.runtimeEvidencePredicate &&
        !rule.runtimeEvidencePredicate({
          capabilities,
          hasCatalogEvidence,
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
