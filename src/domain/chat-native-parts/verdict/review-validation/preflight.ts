import type { z } from "zod";

import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

function getBlockedReviewOutcomeType(decision: VerdictReviewObject["preflightDecision"]) {
  switch (decision) {
    case "needs-clarification":
      return "needs-clarification";
    case "external-research-required":
      return "external-research-required";
    case "abstain":
      return "abstained-before-execution";
    case "proceed":
    case undefined:
      return undefined;
  }
}

export function refineVerdictReviewPreflight(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  const expectedBlockedOutcomeType = value.preflightDecision
    ? getBlockedReviewOutcomeType(value.preflightDecision)
    : undefined;

  if (expectedBlockedOutcomeType && value.outcomeType !== expectedBlockedOutcomeType) {
    addVerdictReviewIssue(
      context,
      ["outcomeType"],
      `preflightDecision ${value.preflightDecision} requires outcomeType ${expectedBlockedOutcomeType}.`,
    );
  }

  if (
    value.preflightDecision === "proceed" &&
    (value.outcomeType === "needs-clarification" ||
      value.outcomeType === "external-research-required" ||
      value.outcomeType === "abstained-before-execution")
  ) {
    addVerdictReviewIssue(
      context,
      ["outcomeType"],
      "preflightDecision proceed cannot use a blocked preflight outcomeType.",
    );
  }
}
