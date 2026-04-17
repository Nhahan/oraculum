import type { z } from "zod";

import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

export function refineVerdictReviewSecondOpinion(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  if (value.secondOpinionAgreement && !value.artifactAvailability.secondOpinionWinnerSelection) {
    addVerdictReviewIssue(
      context,
      ["artifactAvailability", "secondOpinionWinnerSelection"],
      "secondOpinionWinnerSelection artifact availability must be true when second-opinion review fields are present.",
    );
  }

  if (value.artifactAvailability.secondOpinionWinnerSelection && !value.secondOpinionAgreement) {
    addVerdictReviewIssue(
      context,
      ["secondOpinionAgreement"],
      "secondOpinionAgreement is required when a second-opinion winner-selection artifact is available.",
    );
  }

  if (value.secondOpinionAgreement) {
    if (!value.secondOpinionAdapter) {
      addVerdictReviewIssue(
        context,
        ["secondOpinionAdapter"],
        "secondOpinionAdapter is required when second-opinion review fields are present.",
      );
    }
    if (!value.secondOpinionSummary) {
      addVerdictReviewIssue(
        context,
        ["secondOpinionSummary"],
        "secondOpinionSummary is required when second-opinion review fields are present.",
      );
    }
    if (value.secondOpinionTriggerKinds.length === 0) {
      addVerdictReviewIssue(
        context,
        ["secondOpinionTriggerKinds"],
        "secondOpinionTriggerKinds must be present when second-opinion review fields are present.",
      );
    }
    if (value.secondOpinionTriggerReasons.length === 0) {
      addVerdictReviewIssue(
        context,
        ["secondOpinionTriggerReasons"],
        "secondOpinionTriggerReasons must be present when second-opinion review fields are present.",
      );
    }
  }

  if (value.secondOpinionDecision === "select" && !value.secondOpinionCandidateId) {
    addVerdictReviewIssue(
      context,
      ["secondOpinionCandidateId"],
      "secondOpinionCandidateId is required when secondOpinionDecision is select.",
    );
  }

  if (value.secondOpinionDecision !== "select" && value.secondOpinionCandidateId) {
    addVerdictReviewIssue(
      context,
      ["secondOpinionCandidateId"],
      "secondOpinionCandidateId is only allowed when secondOpinionDecision is select.",
    );
  }

  if (value.secondOpinionAgreement === "unavailable" && value.secondOpinionDecision !== undefined) {
    addVerdictReviewIssue(
      context,
      ["secondOpinionDecision"],
      "secondOpinionDecision cannot be present when secondOpinionAgreement is unavailable.",
    );
  }

  if (
    value.outcomeType === "recommended-survivor" &&
    value.secondOpinionAgreement &&
    value.secondOpinionAgreement !== "agrees-select" &&
    !value.manualReviewRecommended
  ) {
    addVerdictReviewIssue(
      context,
      ["manualReviewRecommended"],
      "recommended-survivor reviews must recommend manual review when the second opinion disagrees or is unavailable.",
    );
  }
}
