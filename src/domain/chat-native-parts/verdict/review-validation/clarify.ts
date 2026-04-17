import type { z } from "zod";

import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

export function refineVerdictReviewClarify(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  if (
    value.artifactAvailability.clarifyFollowUp &&
    !(
      value.clarifyScopeKeyType &&
      value.clarifyScopeKey &&
      value.clarifyRepeatedCaseCount &&
      value.clarifyFollowUpQuestion &&
      value.clarifyMissingResultContract &&
      value.clarifyMissingJudgingBasis
    )
  ) {
    addVerdictReviewIssue(
      context,
      ["clarifyFollowUpQuestion"],
      "clarify follow-up review fields are required when a clarify-follow-up artifact is available.",
    );
  }

  if (
    (value.clarifyScopeKeyType ||
      value.clarifyScopeKey ||
      value.clarifyRepeatedCaseCount ||
      value.clarifyFollowUpQuestion ||
      value.clarifyMissingResultContract ||
      value.clarifyMissingJudgingBasis) &&
    !value.artifactAvailability.clarifyFollowUp
  ) {
    addVerdictReviewIssue(
      context,
      ["artifactAvailability", "clarifyFollowUp"],
      "clarifyFollowUp artifact availability must be true when clarify follow-up review fields are present.",
    );
  }

  if (
    value.artifactAvailability.clarifyFollowUp &&
    value.outcomeType !== "needs-clarification" &&
    value.outcomeType !== "external-research-required"
  ) {
    addVerdictReviewIssue(
      context,
      ["outcomeType"],
      "clarify-follow-up artifacts are only valid for needs-clarification or external-research-required reviews.",
    );
  }
}
