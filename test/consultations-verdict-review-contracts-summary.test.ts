import { describe, it } from "vitest";

import { expectVerdictReviewParseError } from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("rejects non-recommended review payloads that still include a recommended candidate id", () => {
    expectVerdictReviewParseError(
      "recommendedCandidateId is only allowed when outcomeType is recommended-survivor",
      {
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        recommendedCandidateId: "cand-01",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
      },
    );
  });

  it("rejects non-finalist review payloads that still include finalist ids", () => {
    expectVerdictReviewParseError("no-survivors reviews require finalistIds to be empty", {
      outcomeType: "no-survivors",
      verificationLevel: "none",
      validationPosture: "unknown",
      judgingBasisKind: "unknown",
      recommendedCandidateId: undefined,
      finalistIds: ["cand-01"],
      validationSignals: [],
      validationGaps: [],
      researchPosture: "unknown",
    });
  });
});
