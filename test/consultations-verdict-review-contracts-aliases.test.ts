import { describe, expect, it } from "vitest";

import { parseVerdictReview } from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("validates canonical research review fields", () => {
    const conflicted = parseVerdictReview({
      outcomeType: "external-research-required",
      verificationLevel: "none",
      validationPosture: "validation-gaps",
      judgingBasisKind: "missing-capability",
      researchBasisStatus: "current",
      researchConflictHandling: "manual-review-required",
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
      researchBasisStatus: "current",
      researchConflictHandling: "accepted",
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
});
