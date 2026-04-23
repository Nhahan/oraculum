import { buildAgentProfileRecommendationJsonSchema } from "../../domain/profile.js";

import {
  buildAgentCandidateSpecJsonSchema,
  buildAgentCandidateSpecSelectionJsonSchema,
  buildAgentClarifyFollowUpJsonSchema,
  buildAgentPlanConsensusDraftJsonSchema,
  buildAgentPlanConsensusReviewJsonSchema,
  buildAgentPlanningContinuationJsonSchema,
  buildAgentPlanningDepthJsonSchema,
  buildAgentPlanningQuestionJsonSchema,
  buildAgentPlanningScoreJsonSchema,
  buildAgentPlanningSpecJsonSchema,
  buildAgentPlanReviewJsonSchema,
  buildAgentPreflightJsonSchema,
} from "../types.js";

export function buildCodexWinnerRecommendationSchema(): Record<string, unknown> {
  const judgingCriteriaProperty = {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
    },
    minItems: 1,
    maxItems: 5,
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["select", "abstain"],
      },
      candidateId: buildCodexNullableSchema({ type: "string", minLength: 1 }),
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string", minLength: 1 },
      judgingCriteria: buildCodexNullableSchema(judgingCriteriaProperty),
    },
    required: ["decision", "candidateId", "confidence", "summary", "judgingCriteria"],
  };
}

export function buildCodexPreflightJsonSchema(): Record<string, unknown> {
  const base = buildAgentPreflightJsonSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  return {
    ...base,
    properties: {
      ...base.properties,
      clarificationQuestion: buildCodexNullableSchema(base.properties.clarificationQuestion ?? {}),
      researchQuestion: buildCodexNullableSchema(base.properties.researchQuestion ?? {}),
    },
    required: Object.keys(base.properties),
  };
}

export function buildCodexClarifyFollowUpJsonSchema(): Record<string, unknown> {
  return buildAgentClarifyFollowUpJsonSchema();
}

export function buildCodexPlanReviewJsonSchema(): Record<string, unknown> {
  return buildAgentPlanReviewJsonSchema();
}

export function buildCodexProfileRecommendationJsonSchema(): Record<string, unknown> {
  const base = buildAgentProfileRecommendationJsonSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  return {
    ...base,
    properties: {
      ...base.properties,
      profileId: buildCodexNullableSchema(base.properties.profileId ?? {}),
      summary: buildCodexNullableSchema(base.properties.summary ?? {}),
      missingCapabilities: buildCodexNullableSchema(base.properties.missingCapabilities ?? {}),
    },
    required: Object.keys(base.properties),
  };
}

export function buildCodexCandidateSpecJsonSchema(): Record<string, unknown> {
  return buildAgentCandidateSpecJsonSchema();
}

export function buildCodexSpecSelectionJsonSchema(): Record<string, unknown> {
  return buildAgentCandidateSpecSelectionJsonSchema();
}

export function buildCodexPlanningDepthJsonSchema(): Record<string, unknown> {
  return buildAgentPlanningDepthJsonSchema();
}

export function buildCodexPlanningContinuationJsonSchema(): Record<string, unknown> {
  return buildAgentPlanningContinuationJsonSchema();
}

export function buildCodexPlanningQuestionJsonSchema(): Record<string, unknown> {
  const base = buildAgentPlanningQuestionJsonSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  return {
    ...base,
    required: Object.keys(base.properties),
  };
}

export function buildCodexPlanningScoreJsonSchema(): Record<string, unknown> {
  return buildAgentPlanningScoreJsonSchema();
}

export function buildCodexPlanningSpecJsonSchema(): Record<string, unknown> {
  return buildAgentPlanningSpecJsonSchema();
}

export function buildCodexPlanConsensusDraftJsonSchema(): Record<string, unknown> {
  return buildAgentPlanConsensusDraftJsonSchema();
}

export function buildCodexPlanConsensusReviewJsonSchema(): Record<string, unknown> {
  return buildAgentPlanConsensusReviewJsonSchema();
}

function buildCodexNullableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    anyOf: [schema, { type: "null" }],
  };
}
