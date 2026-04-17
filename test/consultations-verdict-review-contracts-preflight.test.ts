import { describe, it } from "vitest";

import { expectVerdictReviewParseError } from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("rejects review payloads whose validation-gap semantics disagree with the outcome type", () => {
    expectVerdictReviewParseError("no-survivors reviews require validationGaps to be empty", {
      outcomeType: "no-survivors",
      verificationLevel: "none",
      validationPosture: "unknown",
      judgingBasisKind: "unknown",
      recommendedCandidateId: undefined,
      finalistIds: [],
      validationSignals: [],
      validationGaps: ["No build validation command was selected."],
      researchPosture: "unknown",
    });

    expectVerdictReviewParseError(
      "completed-with-validation-gaps reviews require validationPosture to be validation-gaps",
      {
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "missing-capability",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
      },
    );

    expectVerdictReviewParseError(
      "no-survivors reviews cannot use validation-gaps validationPosture",
      {
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
      },
    );
  });

  it("rejects blocked-preflight review payloads whose validationPosture disagrees with the blocked state", () => {
    expectVerdictReviewParseError(
      "external-research-required reviews require validationPosture to be validation-gaps",
      {
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchRerunRecommended: true,
        researchPosture: "external-research-required",
      },
    );

    expectVerdictReviewParseError(
      "needs-clarification reviews require validationPosture to be unknown",
      {
        outcomeType: "needs-clarification",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
      },
    );
  });

  it("rejects review payloads whose preflightDecision disagrees with the blocked outcome type", () => {
    expectVerdictReviewParseError(
      "preflightDecision needs-clarification requires outcomeType needs-clarification",
      {
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "repo-only",
        preflightDecision: "needs-clarification",
      },
    );

    expectVerdictReviewParseError(
      "preflightDecision proceed cannot use a blocked preflight outcomeType",
      {
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        recommendedCandidateId: undefined,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "external-research-required",
        preflightDecision: "proceed",
      },
    );
  });
});
