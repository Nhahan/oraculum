import { describe, expect, it } from "vitest";

import {
  agentProfileRecommendationSchema,
  consultationProfileSelectionSchema,
} from "../src/domain/profile.js";

describe("consultation auto profile contracts", () => {
  it("parses canonical agent profile recommendations", () => {
    const parsed = agentProfileRecommendationSchema.parse({
      validationProfileId: "frontend",
      confidence: "medium",
      validationSummary: "Frontend evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      selectedCommandIds: ["lint-fast"],
      validationGaps: ["No build validation command was selected."],
    });

    expect(parsed.validationProfileId).toBe("frontend");
    expect(parsed.validationSummary).toBe("Frontend evidence is strongest.");
    expect(parsed.validationGaps).toEqual(["No build validation command was selected."]);
  });

  it("accepts non-enum validation posture ids at the agent recommendation boundary", () => {
    const parsed = agentProfileRecommendationSchema.parse({
      validationProfileId: "docs-review",
      confidence: "medium",
      validationSummary: "Docs review evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      selectedCommandIds: [],
      validationGaps: [],
    });

    expect(parsed.validationProfileId).toBe("docs-review");
    expect(parsed.validationSummary).toBe("Docs review evidence is strongest.");
  });

  it("rejects agent profile recommendations that omit selected commands", () => {
    expect(() =>
      agentProfileRecommendationSchema.parse({
        validationProfileId: "frontend",
        confidence: "medium",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        validationGaps: [],
      }),
    ).toThrow();
  });

  it("rejects agent profile recommendations that omit validation gaps", () => {
    expect(() =>
      agentProfileRecommendationSchema.parse({
        validationProfileId: "frontend",
        confidence: "medium",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast"],
      }),
    ).toThrow();
  });

  it("parses canonical consultation profile selections", () => {
    const parsed = consultationProfileSelectionSchema.parse({
      validationProfileId: "frontend",
      confidence: "medium",
      source: "llm-recommendation",
      validationSummary: "Frontend evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      oracleIds: ["lint-fast"],
      validationSignals: ["repo-local-validation", "repo-e2e-anchor"],
      validationGaps: ["No build validation command was selected."],
    });

    expect(parsed.validationProfileId).toBe("frontend");
    expect(parsed.validationSummary).toBe("Frontend evidence is strongest.");
    expect(parsed.validationSignals).toEqual(["repo-local-validation", "repo-e2e-anchor"]);
    expect(parsed.validationGaps).toEqual(["No build validation command was selected."]);
  });

  it("preserves canonical consultation profile array ordering", () => {
    const parsed = consultationProfileSelectionSchema.parse({
      validationProfileId: "frontend",
      confidence: "medium",
      source: "llm-recommendation",
      validationSummary: "Frontend evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      oracleIds: ["lint-fast"],
      validationSignals: ["repo-e2e-anchor", "repo-local-validation"],
      validationGaps: [
        "No e2e or visual deep check was selected.",
        "No build validation command was selected.",
      ],
    });

    expect(parsed.validationSignals).toEqual(["repo-e2e-anchor", "repo-local-validation"]);
    expect(parsed.validationGaps).toEqual([
      "No e2e or visual deep check was selected.",
      "No build validation command was selected.",
    ]);
  });
});
