import type { z } from "zod";

import { stringArrayMembersEqual } from "../../../schema-compat.js";
import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

export function refineVerdictReviewOutcome(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  const persistedFinalistCount =
    (value.candidateStateCounts.promoted ?? 0) + (value.candidateStateCounts.exported ?? 0);

  if (value.outcomeType === "recommended-survivor" && !value.recommendedCandidateId) {
    addVerdictReviewIssue(
      context,
      ["recommendedCandidateId"],
      "recommendedCandidateId is required when outcomeType is recommended-survivor.",
    );
  }

  if (value.outcomeType !== "recommended-survivor" && value.recommendedCandidateId) {
    addVerdictReviewIssue(
      context,
      ["recommendedCandidateId"],
      "recommendedCandidateId is only allowed when outcomeType is recommended-survivor.",
    );
  }

  if (value.outcomeType === "recommended-survivor" && value.recommendationAbsenceReason) {
    addVerdictReviewIssue(
      context,
      ["recommendationAbsenceReason"],
      "recommended-survivor reviews cannot include recommendationAbsenceReason.",
    );
  }

  if (value.outcomeType !== "recommended-survivor" && value.recommendationSummary) {
    addVerdictReviewIssue(
      context,
      ["recommendationSummary"],
      "recommendationSummary is only allowed when outcomeType is recommended-survivor.",
    );
  }

  if (value.outcomeType === "recommended-survivor" && value.finalistIds.length < 1) {
    addVerdictReviewIssue(
      context,
      ["finalistIds"],
      "recommended-survivor reviews require at least one finalist id.",
    );
  }

  if (
    value.outcomeType === "recommended-survivor" &&
    value.recommendedCandidateId &&
    !value.finalistIds.includes(value.recommendedCandidateId)
  ) {
    addVerdictReviewIssue(
      context,
      ["finalistIds"],
      "recommended-survivor reviews must include recommendedCandidateId in finalistIds.",
    );
  }

  if (
    (value.outcomeType === "recommended-survivor" ||
      value.outcomeType === "finalists-without-recommendation") &&
    persistedFinalistCount > 0 &&
    value.finalistIds.length !== persistedFinalistCount
  ) {
    addVerdictReviewIssue(
      context,
      ["finalistIds"],
      "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present.",
    );
  }

  if (
    value.outcomeType !== "recommended-survivor" &&
    value.outcomeType !== "finalists-without-recommendation" &&
    value.finalistIds.length > 0
  ) {
    addVerdictReviewIssue(
      context,
      ["finalistIds"],
      `${value.outcomeType} reviews require finalistIds to be empty.`,
    );
  }

  if (
    value.outcomeType !== "finalists-without-recommendation" &&
    value.manualCrowningCandidateIds.length > 0
  ) {
    addVerdictReviewIssue(
      context,
      ["manualCrowningCandidateIds"],
      "manualCrowningCandidateIds are only allowed when outcomeType is finalists-without-recommendation.",
    );
  }

  if (
    value.outcomeType === "finalists-without-recommendation" &&
    value.manualCrowningCandidateIds.length > 0 &&
    !stringArrayMembersEqual(value.manualCrowningCandidateIds, value.finalistIds)
  ) {
    addVerdictReviewIssue(
      context,
      ["manualCrowningCandidateIds"],
      "manualCrowningCandidateIds must match finalistIds when manual crowning is exposed.",
    );
  }

  if (value.manualCrowningCandidateIds.length > 0 && !value.manualReviewRecommended) {
    addVerdictReviewIssue(
      context,
      ["manualReviewRecommended"],
      "manualReviewRecommended must be true when manual crowning candidates are exposed.",
    );
  }

  if (value.manualCrowningReason && value.manualCrowningCandidateIds.length === 0) {
    addVerdictReviewIssue(
      context,
      ["manualCrowningReason"],
      "manualCrowningReason is only allowed when manual crowning candidates are exposed.",
    );
  }

  if (
    (value.outcomeType === "finalists-without-recommendation" ||
      value.outcomeType === "completed-with-validation-gaps" ||
      value.outcomeType === "needs-clarification" ||
      value.outcomeType === "external-research-required") &&
    !value.manualReviewRecommended
  ) {
    addVerdictReviewIssue(
      context,
      ["manualReviewRecommended"],
      `${value.outcomeType} reviews must recommend manual review.`,
    );
  }
}
