import type { AgentProfileRecommendation, ProfileRepoSignals } from "../../../domain/profile.js";
import {
  agentProfileRecommendationSchema,
  isSupportedConsultationProfileId,
  profileStrategyIds,
} from "../../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

import {
  clampCandidateCount,
  FALLBACK_STRATEGY_IDS,
  type FallbackDetectedProfileId,
} from "../shared.js";
import {
  buildFallbackCommandSlots,
  chooseFallbackCommandIds,
  inferGenericFallbackValidationGaps,
} from "./commands.js";
import {
  FALLBACK_DEFAULT_CANDIDATE_COUNT,
  FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT,
} from "./config.js";
import { buildFallbackSummary } from "./summary.js";

export function buildFallbackRecommendation(
  signals: ProfileRepoSignals,
  taskPacket: MaterializedTaskPacket,
): AgentProfileRecommendation {
  const chosenProfile: FallbackDetectedProfileId = "generic";
  const hasRepoLocalCommands = signals.commandCatalog.some(
    (command) => command.source === "repo-local-script",
  );
  const confidence = hasRepoLocalCommands ? "medium" : "low";

  const selectedCommandIds = chooseFallbackCommandIds(
    buildFallbackCommandSlots(),
    signals.commandCatalog,
  );
  const validationGaps = inferGenericFallbackValidationGaps(
    selectedCommandIds,
    signals.commandCatalog,
  );

  return agentProfileRecommendationSchema.parse({
    validationProfileId: chosenProfile,
    confidence,
    validationSummary: buildFallbackSummary(chosenProfile, confidence, taskPacket),
    candidateCount:
      confidence === "low"
        ? FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT
        : FALLBACK_DEFAULT_CANDIDATE_COUNT,
    strategyIds: FALLBACK_STRATEGY_IDS,
    selectedCommandIds,
    validationGaps,
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
  const validationGaps = [
    ...new Set([
      ...recommendation.validationGaps,
      ...inferGenericFallbackValidationGaps(selectedCommandIds, signals.commandCatalog),
    ]),
  ];

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
