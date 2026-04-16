import { describe, expect, it } from "vitest";

import {
  agentProfileRecommendationSchema,
  consultationProfileSelectionSchema,
} from "../src/domain/profile.js";

describe("consultation auto profile contracts", () => {
  it("backfills legacy aliases from validation-first agent profile recommendations", () => {
    const parsed = agentProfileRecommendationSchema.parse({
      validationProfileId: "frontend",
      confidence: "medium",
      validationSummary: "Frontend evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      selectedCommandIds: ["lint-fast"],
      validationGaps: ["No build validation command was selected."],
    });

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.summary).toBe("Frontend evidence is strongest.");
    expect(parsed.missingCapabilities).toEqual(["No build validation command was selected."]);
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
    expect(parsed.profileId).toBe("docs-review");
    expect(parsed.validationSummary).toBe("Docs review evidence is strongest.");
    expect(parsed.summary).toBe("Docs review evidence is strongest.");
  });

  it("rejects conflicting legacy agent profile recommendation aliases", () => {
    expect(() =>
      agentProfileRecommendationSchema.parse({
        profileId: "library",
        validationProfileId: "frontend",
        confidence: "medium",
        summary: "Frontend evidence is strongest.",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: [],
        missingCapabilities: ["No build validation command was selected."],
        validationGaps: ["No build validation command was selected."],
      }),
    ).toThrow("profileId must match validationProfileId");
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

  it("backfills legacy aliases from validation-first consultation profile selections", () => {
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

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.summary).toBe("Frontend evidence is strongest.");
    expect(parsed.signals).toEqual(["repo-local-validation", "repo-e2e-anchor"]);
    expect(parsed.missingCapabilities).toEqual(["No build validation command was selected."]);
  });

  it("accepts reordered legacy consultation profile alias arrays", () => {
    const parsed = consultationProfileSelectionSchema.parse({
      profileId: "frontend",
      validationProfileId: "frontend",
      confidence: "medium",
      source: "llm-recommendation",
      summary: "Frontend evidence is strongest.",
      validationSummary: "Frontend evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change"],
      oracleIds: ["lint-fast"],
      signals: ["repo-e2e-anchor", "repo-local-validation"],
      validationSignals: ["repo-local-validation", "repo-e2e-anchor"],
      missingCapabilities: [
        "No e2e or visual deep check was selected.",
        "No build validation command was selected.",
      ],
      validationGaps: [
        "No build validation command was selected.",
        "No e2e or visual deep check was selected.",
      ],
    });

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.validationProfileId).toBe("frontend");
    expect(parsed.signals).toEqual(["repo-e2e-anchor", "repo-local-validation"]);
    expect(parsed.validationSignals).toEqual(["repo-local-validation", "repo-e2e-anchor"]);
    expect(parsed.missingCapabilities).toEqual([
      "No e2e or visual deep check was selected.",
      "No build validation command was selected.",
    ]);
    expect(parsed.validationGaps).toEqual([
      "No build validation command was selected.",
      "No e2e or visual deep check was selected.",
    ]);
  });

  it("rejects conflicting legacy consultation profile aliases", () => {
    expect(() =>
      consultationProfileSelectionSchema.parse({
        profileId: "library",
        validationProfileId: "frontend",
        confidence: "medium",
        source: "llm-recommendation",
        summary: "Frontend evidence is strongest.",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast"],
        signals: ["repo-local-validation", "repo-e2e-anchor"],
        validationSignals: ["repo-e2e-anchor", "repo-local-validation"],
        missingCapabilities: ["No build validation command was selected."],
        validationGaps: ["No build validation command was selected."],
      }),
    ).toThrow("profileId must match validationProfileId");
  });
});
