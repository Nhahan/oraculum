import { describe, it } from "vitest";

import { expectVerdictReviewParseError } from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("rejects recommended-survivor review payloads that omit the recommended candidate id", () => {
    expectVerdictReviewParseError(
      "recommendedCandidateId is required when outcomeType is recommended-survivor",
      {
        recommendedCandidateId: undefined,
      },
    );
  });

  it("rejects review payloads whose finalist ids do not match survivor semantics", () => {
    expectVerdictReviewParseError("recommended-survivor reviews require at least one finalist id", {
      finalistIds: [],
    });

    expectVerdictReviewParseError(
      "recommended-survivor reviews must include recommendedCandidateId in finalistIds",
      {
        finalistIds: ["cand-02"],
      },
    );

    expectVerdictReviewParseError(
      "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present",
      {
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "standard",
        finalistIds: [],
        recommendedCandidateId: undefined,
        manualReviewRecommended: true,
        candidateStateCounts: {
          promoted: 1,
        },
      },
    );
  });

  it("rejects manual crowning ids that do not match finalists-without-recommendation reviews", () => {
    expectVerdictReviewParseError("manualCrowningCandidateIds must match finalistIds", {
      outcomeType: "finalists-without-recommendation",
      finalistIds: ["cand-01"],
      recommendedCandidateId: undefined,
      manualCrowningCandidateIds: ["cand-02"],
      manualReviewRecommended: true,
      artifactAvailability: {
        winnerSelection: true,
      },
      candidateStateCounts: {
        promoted: 1,
      },
    });
  });

  it("rejects manual crowning ids when manual review is not recommended", () => {
    expectVerdictReviewParseError("manualReviewRecommended must be true", {
      outcomeType: "finalists-without-recommendation",
      finalistIds: ["cand-01"],
      recommendedCandidateId: undefined,
      manualCrowningCandidateIds: ["cand-01"],
      manualReviewRecommended: false,
      artifactAvailability: {
        winnerSelection: true,
      },
      candidateStateCounts: {
        promoted: 1,
      },
    });
  });

  it("rejects manual crowning reasons without exposed manual crowning candidates", () => {
    expectVerdictReviewParseError("manualCrowningReason is only allowed", {
      outcomeType: "no-survivors",
      verificationLevel: "none",
      validationPosture: "sufficient",
      judgingBasisKind: "unknown",
      recommendedCandidateId: undefined,
      finalistIds: [],
      manualReviewRecommended: true,
      manualCrowningReason: "Operator review is required before crowning.",
    });
  });

  it("rejects finalists-without-recommendation reviews that do not recommend manual review", () => {
    expectVerdictReviewParseError(
      "finalists-without-recommendation reviews must recommend manual review",
      {
        outcomeType: "finalists-without-recommendation",
        finalistIds: ["cand-01"],
        recommendedCandidateId: undefined,
        manualReviewRecommended: false,
        artifactAvailability: {
          winnerSelection: true,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      },
    );
  });

  it("rejects validation-gap reviews that do not recommend manual review", () => {
    expectVerdictReviewParseError(
      "completed-with-validation-gaps reviews must recommend manual review",
      {
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "lightweight",
        validationPosture: "validation-gaps",
        judgingBasisKind: "missing-capability",
        recommendedCandidateId: undefined,
        finalistIds: [],
        manualReviewRecommended: false,
        validationGaps: ["No repo-local oracle was recorded."],
      },
    );
  });

  it("rejects recommended-survivor reviews that hide second-opinion disagreement without manual review", () => {
    expectVerdictReviewParseError("recommended-survivor reviews must recommend manual review", {
      secondOpinionAdapter: "claude-code",
      secondOpinionAgreement: "disagrees-select-vs-abstain",
      secondOpinionSummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
      secondOpinionDecision: "abstain",
      secondOpinionTriggerKinds: ["many-changed-paths"],
      secondOpinionTriggerReasons: ["A finalist changed 3 paths, meeting the threshold."],
      manualReviewRecommended: false,
      artifactAvailability: {
        comparisonReport: true,
        winnerSelection: true,
        secondOpinionWinnerSelection: true,
      },
      candidateStateCounts: {
        promoted: 1,
      },
    });
  });
});
