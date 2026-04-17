import { decisionConfidenceLevels, profileStrategyIds } from "./constants.js";

export function buildAgentProfileRecommendationJsonSchema(): Record<string, unknown> {
  const properties = {
    profileId: {
      type: "string",
    },
    validationProfileId: {
      type: "string",
    },
    confidence: {
      type: "string",
      enum: [...decisionConfidenceLevels],
    },
    summary: { type: "string", minLength: 1 },
    validationSummary: { type: "string", minLength: 1 },
    candidateCount: { type: "integer", minimum: 1, maximum: 16 },
    strategyIds: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "string",
        enum: [...profileStrategyIds],
      },
    },
    selectedCommandIds: {
      type: "array",
      items: { type: "string" },
    },
    missingCapabilities: {
      type: "array",
      items: { type: "string" },
    },
    validationGaps: {
      type: "array",
      items: { type: "string" },
    },
  } satisfies Record<string, unknown>;

  const commonRequired = ["confidence", "candidateCount", "strategyIds", "selectedCommandIds"];

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...commonRequired, "validationProfileId", "validationSummary", "validationGaps"],
  };
}
