import { describe, expect, it } from "vitest";
import { extractCodexPlanConsensusContinuationRecommendation } from "../src/adapters/codex/parsing.js";
import {
  buildCodexCandidateSpecJsonSchema,
  buildCodexClarifyFollowUpJsonSchema,
  buildCodexPlanConsensusContinuationJsonSchema,
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
      buildCodexPlanConsensusContinuationJsonSchema(),
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

  it("requires the canonical planning consensus intensity levels", () => {
    const schema = buildCodexPlanningDepthJsonSchema() as {
      properties: Record<string, { enum?: string[] }>;
    };

    expect(schema.properties.consensusReviewIntensity?.enum).toEqual([
      "standard",
      "elevated",
      "high",
    ]);
  });

  it("classifies Plan Conclave continuation as remediation or new task", () => {
    const schema = buildCodexPlanConsensusContinuationJsonSchema() as {
      properties: Record<string, { enum?: string[] }>;
    };

    expect(schema.properties.classification?.enum).toEqual(["consensus-remediation", "new-task"]);
    expect(
      extractCodexPlanConsensusContinuationRecommendation(
        JSON.stringify({
          classification: "continuation",
          confidence: "high",
          summary: "Wrong classifier family.",
        }),
      ),
    ).toBeUndefined();
  });

  it("requires Augury answer shape and Plan Conclave scoring policy fields", () => {
    const questionSchema = buildCodexPlanningQuestionJsonSchema() as {
      required?: string[];
    };
    const draftSchema = buildCodexPlanConsensusDraftJsonSchema() as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(questionSchema.required).toContain("expectedAnswerShape");
    expect(draftSchema.required).toContain("scorecardDefinition");
    expect(draftSchema.required).toContain("repairPolicy");
    expect(Object.keys(draftSchema.properties ?? {})).toContain("scorecardDefinition");
    expect(Object.keys(draftSchema.properties ?? {})).toContain("repairPolicy");
  });

  it("keeps Codex nullable placeholders schema-complete for optional recommendation fields", () => {
    const preflightSchema = buildCodexPreflightJsonSchema() as {
      properties?: Record<string, { anyOf?: Array<{ type?: string }> }>;
      required?: string[];
    };
    const profileSchema = buildCodexProfileRecommendationJsonSchema() as {
      properties?: Record<string, { anyOf?: Array<{ type?: string }> }>;
      required?: string[];
    };
    const winnerSchema = buildCodexWinnerRecommendationSchema() as {
      properties?: Record<string, { anyOf?: Array<{ type?: string }> }>;
      required?: string[];
    };

    expect(preflightSchema.required).toEqual(
      expect.arrayContaining(["clarificationQuestion", "researchQuestion"]),
    );
    expect(preflightSchema.properties?.clarificationQuestion?.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "string" }),
        expect.objectContaining({ type: "null" }),
      ]),
    );
    expect(profileSchema.required).not.toEqual(
      expect.arrayContaining(["profileId", "summary", "missingCapabilities"]),
    );
    expect(profileSchema.properties).not.toHaveProperty("profileId");
    expect(winnerSchema.required).toEqual(
      expect.arrayContaining(["candidateId", "judgingCriteria"]),
    );
    expect(winnerSchema.properties?.candidateId?.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "string" }),
        expect.objectContaining({ type: "null" }),
      ]),
    );
  });
});
