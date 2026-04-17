import { describe, expect, it } from "vitest";

import { verdictReviewSchema } from "../src/domain/chat-native.js";
import {
  createVerdictReviewInput,
  parseVerdictReview,
} from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("backfills and validates legacy verdict review aliases at the schema boundary", () => {
    const parsed = verdictReviewSchema.parse(
      createVerdictReviewInput({
        profileId: undefined,
        profileMissingCapabilities: undefined,
        validationPosture: "validation-gaps",
        validationProfileId: "frontend",
        validationSignals: ["frontend-framework"],
        validationGaps: ["No build validation command was selected."],
      }),
    );

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.profileMissingCapabilities).toEqual([
      "No build validation command was selected.",
    ]);

    expect(() =>
      verdictReviewSchema.parse({
        ...parsed,
        profileId: "library",
      }),
    ).toThrow("profileId must match validationProfileId");
  });

  it("backfills researchConflictHandling from persisted verdict review research signals", () => {
    const conflicted = parseVerdictReview({
      outcomeType: "external-research-required",
      verificationLevel: "none",
      validationPosture: "validation-gaps",
      judgingBasisKind: "missing-capability",
      researchBasisStatus: undefined,
      recommendedCandidateId: undefined,
      finalistIds: [],
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSummary: "External documentation still contains conflicting guidance.",
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchConflictCount: 1,
      researchConflictsPresent: true,
      manualReviewRecommended: true,
      artifactAvailability: {
        researchBrief: true,
      },
    });

    const current = parseVerdictReview({
      researchBasisStatus: undefined,
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 1,
      researchSignalFingerprint: "fingerprint",
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchPosture: "repo-plus-external-docs",
      artifactAvailability: {
        researchBrief: true,
      },
    });

    expect(conflicted.researchBasisStatus).toBe("current");
    expect(conflicted.researchConflictHandling).toBe("manual-review-required");
    expect(current.researchConflictHandling).toBe("accepted");
  });

  it("accepts reordered legacy verdict review gap aliases", () => {
    const parsed = verdictReviewSchema.parse(
      createVerdictReviewInput({
        profileId: undefined,
        validationPosture: "validation-gaps",
        validationProfileId: "frontend",
        validationSignals: ["frontend-framework"],
        validationGaps: [
          "No build validation command was selected.",
          "No e2e or visual deep check was detected.",
        ],
        profileMissingCapabilities: [
          "No e2e or visual deep check was detected.",
          "No build validation command was selected.",
        ],
      }),
    );

    expect(parsed.validationGaps).toEqual([
      "No build validation command was selected.",
      "No e2e or visual deep check was detected.",
    ]);
    expect(parsed.profileMissingCapabilities).toEqual([
      "No e2e or visual deep check was detected.",
      "No build validation command was selected.",
    ]);
  });
});
