import type { z } from "zod";

import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

export function refineVerdictReviewValidationPosture(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  if (value.outcomeType === "no-survivors" && value.validationGaps.length > 0) {
    addVerdictReviewIssue(
      context,
      ["validationGaps"],
      "no-survivors reviews require validationGaps to be empty.",
    );
  }

  if (
    value.outcomeType === "completed-with-validation-gaps" &&
    value.validationPosture !== "validation-gaps"
  ) {
    addVerdictReviewIssue(
      context,
      ["validationPosture"],
      "completed-with-validation-gaps reviews require validationPosture to be validation-gaps.",
    );
  }

  if (value.outcomeType === "no-survivors" && value.validationPosture === "validation-gaps") {
    addVerdictReviewIssue(
      context,
      ["validationPosture"],
      "no-survivors reviews cannot use validation-gaps validationPosture.",
    );
  }

  if (
    value.outcomeType === "external-research-required" &&
    value.validationPosture !== "validation-gaps"
  ) {
    addVerdictReviewIssue(
      context,
      ["validationPosture"],
      "external-research-required reviews require validationPosture to be validation-gaps.",
    );
  }

  if (
    (value.outcomeType === "needs-clarification" ||
      value.outcomeType === "abstained-before-execution") &&
    value.validationPosture !== "unknown"
  ) {
    addVerdictReviewIssue(
      context,
      ["validationPosture"],
      `${value.outcomeType} reviews require validationPosture to be unknown.`,
    );
  }
}
