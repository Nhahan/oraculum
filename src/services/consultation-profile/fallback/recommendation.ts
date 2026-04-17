import type { AgentProfileRecommendation, ProfileRepoSignals } from "../../../domain/profile.js";
import {
  agentProfileRecommendationSchema,
  isSupportedConsultationProfileId,
  profileStrategyIds,
} from "../../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

import {
  clampCandidateCount,
  commandSlotKey,
  FALLBACK_STRATEGY_IDS,
  type FallbackAnchoredProfileId,
  type FallbackDetectedProfileId,
} from "../shared.js";
import {
  buildFallbackCommandSlots,
  chooseFallbackCommandIds,
  inferMissingCapabilities,
} from "./commands.js";
import {
  FALLBACK_DEFAULT_CANDIDATE_COUNT,
  FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT,
  VALIDATION_POSTURE_FALLBACK_ANCHORS,
} from "./config.js";
import { buildFallbackSummary } from "./summary.js";

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
      [
        FallbackAnchoredProfileId,
        (typeof VALIDATION_POSTURE_FALLBACK_ANCHORS)[FallbackAnchoredProfileId],
      ]
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
