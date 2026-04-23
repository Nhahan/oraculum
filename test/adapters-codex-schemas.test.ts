import { describe, expect, it } from "vitest";

import {
  buildCodexCandidateSpecJsonSchema,
  buildCodexClarifyFollowUpJsonSchema,
  buildCodexPlanConsensusDraftJsonSchema,
  buildCodexPlanConsensusReviewJsonSchema,
  buildCodexPlanningContinuationJsonSchema,
  buildCodexPlanningDepthJsonSchema,
  buildCodexPlanningQuestionJsonSchema,
  buildCodexPlanningScoreJsonSchema,
  buildCodexPlanningSpecJsonSchema,
  buildCodexPlanReviewJsonSchema,
  buildCodexPreflightJsonSchema,
  buildCodexProfileRecommendationJsonSchema,
  buildCodexSpecSelectionJsonSchema,
  buildCodexWinnerRecommendationSchema,
} from "../src/adapters/codex/schemas.js";

describe("Codex structured output schemas", () => {
  it("marks every top-level property as required for the Responses schema validator", () => {
    const schemas = [
      buildCodexCandidateSpecJsonSchema(),
      buildCodexClarifyFollowUpJsonSchema(),
      buildCodexPlanConsensusDraftJsonSchema(),
      buildCodexPlanConsensusReviewJsonSchema(),
      buildCodexPlanReviewJsonSchema(),
      buildCodexPlanningContinuationJsonSchema(),
      buildCodexPlanningDepthJsonSchema(),
      buildCodexPlanningQuestionJsonSchema(),
      buildCodexPlanningScoreJsonSchema(),
      buildCodexPlanningSpecJsonSchema(),
      buildCodexPreflightJsonSchema(),
      buildCodexProfileRecommendationJsonSchema(),
      buildCodexSpecSelectionJsonSchema(),
      buildCodexWinnerRecommendationSchema(),
    ];

    for (const schema of schemas) {
      const properties =
        schema.properties &&
        typeof schema.properties === "object" &&
        !Array.isArray(schema.properties)
          ? Object.keys(schema.properties)
          : [];
      expect(new Set(schema.required as string[] | undefined)).toEqual(new Set(properties));
    }
  });
});
