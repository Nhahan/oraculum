import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "./accessors.js";
import type {
  AgentProfileRecommendation,
  ConsultationProfileId,
  ConsultationProfileSelection,
  DecisionConfidence,
} from "./schemas.js";

export function toCanonicalAgentProfileRecommendation(recommendation: AgentProfileRecommendation): {
  validationProfileId: string;
  confidence: DecisionConfidence;
  validationSummary: string;
  candidateCount: number;
  strategyIds: string[];
  selectedCommandIds: string[];
  validationGaps: string[];
} {
  const validationProfileId = getValidationProfileId(recommendation);
  const validationSummary = getValidationSummary(recommendation);

  if (!validationProfileId || !validationSummary) {
    throw new Error("Canonical agent profile recommendation requires validation profile fields.");
  }

  return {
    validationProfileId,
    confidence: recommendation.confidence,
    validationSummary,
    candidateCount: recommendation.candidateCount,
    strategyIds: recommendation.strategyIds,
    selectedCommandIds: recommendation.selectedCommandIds,
    validationGaps: getValidationGaps(recommendation),
  };
}

export function toCanonicalConsultationProfileSelection(selection: ConsultationProfileSelection): {
  validationProfileId: ConsultationProfileId;
  confidence: DecisionConfidence;
  source: ConsultationProfileSelection["source"];
  validationSummary: string;
  candidateCount: number;
  strategyIds: string[];
  oracleIds: string[];
  validationGaps: string[];
  validationSignals: string[];
} {
  const validationProfileId = getValidationProfileId(selection);
  const validationSummary = getValidationSummary(selection);

  if (!validationProfileId || !validationSummary) {
    throw new Error("Canonical consultation profile selection requires validation profile fields.");
  }

  return {
    validationProfileId,
    confidence: selection.confidence,
    source: selection.source,
    validationSummary,
    candidateCount: selection.candidateCount,
    strategyIds: selection.strategyIds,
    oracleIds: selection.oracleIds,
    validationGaps: getValidationGaps(selection),
    validationSignals: getValidationSignals(selection),
  };
}
