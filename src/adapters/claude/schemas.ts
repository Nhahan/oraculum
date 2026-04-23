export function buildClaudeWinnerRecommendationSchema(): Record<string, unknown> {
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
      candidateId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string", minLength: 1 },
      judgingCriteria: { anyOf: [judgingCriteriaProperty, { type: "null" }] },
    },
    required: ["decision", "confidence", "summary"],
  };
}
