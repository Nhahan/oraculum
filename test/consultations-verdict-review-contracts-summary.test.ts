import { describe, it } from "vitest";

import { expectVerdictReviewParseError } from "./helpers/verdict-review-contracts.js";

describe("consultation verdict review contracts", () => {
  it("rejects verdict reviews whose outcome summary disagrees with the outcome and task context", () => {
    expectVerdictReviewParseError(
      "outcomeSummary must match outcomeType and task artifact context",
      {
        outcomeSummary: "No recommended document result for docs/SESSION_PLAN.md emerged.",
        judgingBasisSummary: "Judged with repo-local validation oracles.",
        taskArtifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
        candidateStateCounts: {
          promoted: 1,
        },
      },
    );
  });

  it("rejects verdict reviews whose judging basis summary disagrees with the judging basis kind", () => {
    expectVerdictReviewParseError("judgingBasisSummary must match judgingBasisKind", {
      outcomeType: "no-survivors",
      verificationLevel: "none",
      validationPosture: "unknown",
      judgingBasisKind: "unknown",
      outcomeSummary: "No survivors advanced after the oracle rounds.",
      judgingBasisSummary: "Judged with repo-local validation oracles.",
      recommendedCandidateId: undefined,
      finalistIds: [],
    });
  });

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
