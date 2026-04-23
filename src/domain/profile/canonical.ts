import {
  getValidationGaps,
  getValidationSignals,
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
  return {
    validationProfileId: recommendation.validationProfileId,
    confidence: recommendation.confidence,
    validationSummary: recommendation.validationSummary,
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
  return {
    validationProfileId: selection.validationProfileId,
    confidence: selection.confidence,
    source: selection.source,
    validationSummary: selection.validationSummary,
    candidateCount: selection.candidateCount,
    strategyIds: selection.strategyIds,
    oracleIds: selection.oracleIds,
    validationGaps: getValidationGaps(selection),
    validationSignals: getValidationSignals(selection),
  };
}
