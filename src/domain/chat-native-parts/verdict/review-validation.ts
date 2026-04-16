import { z } from "zod";

import {
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
} from "../../run.js";
import { stringArrayMembersEqual } from "../../schema-compat.js";
import type { VerdictReviewObject } from "./review-shape.js";

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

export function refineVerdictReview(value: VerdictReviewObject, context: z.RefinementCtx): void {
  const persistedFinalistCount =
    (value.candidateStateCounts.promoted ?? 0) + (value.candidateStateCounts.exported ?? 0);

  if (
    value.profileId &&
    value.validationProfileId &&
    value.profileId !== value.validationProfileId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profileId"],
      message:
        "profileId must match validationProfileId when both legacy and validation aliases are present.",
    });
  }
  if (
    value.profileMissingCapabilities &&
    !stringArrayMembersEqual(value.profileMissingCapabilities, value.validationGaps)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profileMissingCapabilities"],
      message:
        "profileMissingCapabilities must match validationGaps when both legacy and validation aliases are present.",
    });
  }

  if (
    value.outcomeSummary &&
    value.outcomeSummary !==
      describeConsultationOutcomeSummary({
        outcomeType: value.outcomeType,
        ...(value.taskArtifactKind ? { taskArtifactKind: value.taskArtifactKind } : {}),
        ...(value.targetArtifactPath ? { targetArtifactPath: value.targetArtifactPath } : {}),
      })
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcomeSummary"],
      message: "outcomeSummary must match outcomeType and task artifact context when present.",
    });
  }

  if (
    value.judgingBasisSummary &&
    value.judgingBasisSummary !== describeConsultationJudgingBasisSummary(value.judgingBasisKind)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["judgingBasisSummary"],
      message: "judgingBasisSummary must match judgingBasisKind when present.",
    });
  }

  if (value.researchBasisStatus === "stale" && value.researchBasisDrift !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["researchBasisStatus"],
      message: "researchBasisStatus stale requires researchBasisDrift to be true.",
    });
  }

  if (
    value.researchConflictHandling === "manual-review-required" &&
    !value.researchConflictsPresent
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["researchConflictHandling"],
      message:
        "researchConflictHandling manual-review-required requires researchConflictsPresent to be true.",
    });
  }

  if (
    value.researchConflictsPresent &&
    value.researchConflictHandling &&
    value.researchConflictHandling !== "manual-review-required"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["researchConflictHandling"],
      message:
        "researchConflictHandling must be manual-review-required when researchConflictsPresent is true.",
    });
  }

  if (value.outcomeType === "recommended-survivor" && !value.recommendedCandidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommendedCandidateId"],
      message: "recommendedCandidateId is required when outcomeType is recommended-survivor.",
    });
  }

  if (value.outcomeType !== "recommended-survivor" && value.recommendedCandidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommendedCandidateId"],
      message: "recommendedCandidateId is only allowed when outcomeType is recommended-survivor.",
    });
  }

  if (value.outcomeType === "recommended-survivor" && value.recommendationAbsenceReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommendationAbsenceReason"],
      message: "recommended-survivor reviews cannot include recommendationAbsenceReason.",
    });
  }

  if (value.outcomeType !== "recommended-survivor" && value.recommendationSummary) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recommendationSummary"],
      message: "recommendationSummary is only allowed when outcomeType is recommended-survivor.",
    });
  }

  if (value.outcomeType === "recommended-survivor" && value.finalistIds.length < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalistIds"],
      message: "recommended-survivor reviews require at least one finalist id.",
    });
  }

  if (
    value.outcomeType === "recommended-survivor" &&
    value.recommendedCandidateId &&
    !value.finalistIds.includes(value.recommendedCandidateId)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalistIds"],
      message: "recommended-survivor reviews must include recommendedCandidateId in finalistIds.",
    });
  }

  if (
    (value.outcomeType === "recommended-survivor" ||
      value.outcomeType === "finalists-without-recommendation") &&
    persistedFinalistCount > 0 &&
    value.finalistIds.length !== persistedFinalistCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalistIds"],
      message:
        "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present.",
    });
  }

  if (
    value.outcomeType !== "recommended-survivor" &&
    value.outcomeType !== "finalists-without-recommendation" &&
    value.finalistIds.length > 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalistIds"],
      message: `${value.outcomeType} reviews require finalistIds to be empty.`,
    });
  }

  if (
    value.outcomeType !== "finalists-without-recommendation" &&
    value.manualCrowningCandidateIds.length > 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualCrowningCandidateIds"],
      message:
        "manualCrowningCandidateIds are only allowed when outcomeType is finalists-without-recommendation.",
    });
  }

  if (
    value.outcomeType === "finalists-without-recommendation" &&
    value.manualCrowningCandidateIds.length > 0 &&
    !stringArrayMembersEqual(value.manualCrowningCandidateIds, value.finalistIds)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualCrowningCandidateIds"],
      message: "manualCrowningCandidateIds must match finalistIds when manual crowning is exposed.",
    });
  }

  if (value.manualCrowningCandidateIds.length > 0 && !value.manualReviewRecommended) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualReviewRecommended"],
      message: "manualReviewRecommended must be true when manual crowning candidates are exposed.",
    });
  }

  if (value.manualCrowningReason && value.manualCrowningCandidateIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualCrowningReason"],
      message: "manualCrowningReason is only allowed when manual crowning candidates are exposed.",
    });
  }

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
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clarifyFollowUpQuestion"],
      message:
        "clarify follow-up review fields are required when a clarify-follow-up artifact is available.",
    });
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
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifactAvailability", "clarifyFollowUp"],
      message:
        "clarifyFollowUp artifact availability must be true when clarify follow-up review fields are present.",
    });
  }

  if (
    value.artifactAvailability.clarifyFollowUp &&
    value.outcomeType !== "needs-clarification" &&
    value.outcomeType !== "external-research-required"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcomeType"],
      message:
        "clarify-follow-up artifacts are only valid for needs-clarification or external-research-required reviews.",
    });
  }

  if (
    (value.outcomeType === "finalists-without-recommendation" ||
      value.outcomeType === "completed-with-validation-gaps" ||
      value.outcomeType === "needs-clarification" ||
      value.outcomeType === "external-research-required") &&
    !value.manualReviewRecommended
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualReviewRecommended"],
      message: `${value.outcomeType} reviews must recommend manual review.`,
    });
  }

  if (value.secondOpinionAgreement && !value.artifactAvailability.secondOpinionWinnerSelection) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifactAvailability", "secondOpinionWinnerSelection"],
      message:
        "secondOpinionWinnerSelection artifact availability must be true when second-opinion review fields are present.",
    });
  }

  if (value.artifactAvailability.secondOpinionWinnerSelection && !value.secondOpinionAgreement) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondOpinionAgreement"],
      message:
        "secondOpinionAgreement is required when a second-opinion winner-selection artifact is available.",
    });
  }

  if (value.secondOpinionAgreement) {
    if (!value.secondOpinionAdapter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondOpinionAdapter"],
        message: "secondOpinionAdapter is required when second-opinion review fields are present.",
      });
    }
    if (!value.secondOpinionSummary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondOpinionSummary"],
        message: "secondOpinionSummary is required when second-opinion review fields are present.",
      });
    }
    if (value.secondOpinionTriggerKinds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondOpinionTriggerKinds"],
        message:
          "secondOpinionTriggerKinds must be present when second-opinion review fields are present.",
      });
    }
    if (value.secondOpinionTriggerReasons.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondOpinionTriggerReasons"],
        message:
          "secondOpinionTriggerReasons must be present when second-opinion review fields are present.",
      });
    }
  }

  if (value.secondOpinionDecision === "select" && !value.secondOpinionCandidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondOpinionCandidateId"],
      message: "secondOpinionCandidateId is required when secondOpinionDecision is select.",
    });
  }

  if (value.secondOpinionDecision !== "select" && value.secondOpinionCandidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondOpinionCandidateId"],
      message: "secondOpinionCandidateId is only allowed when secondOpinionDecision is select.",
    });
  }

  if (value.secondOpinionAgreement === "unavailable" && value.secondOpinionDecision !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondOpinionDecision"],
      message:
        "secondOpinionDecision cannot be present when secondOpinionAgreement is unavailable.",
    });
  }

  if (
    value.outcomeType === "recommended-survivor" &&
    value.secondOpinionAgreement &&
    value.secondOpinionAgreement !== "agrees-select" &&
    !value.manualReviewRecommended
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manualReviewRecommended"],
      message:
        "recommended-survivor reviews must recommend manual review when the second opinion disagrees or is unavailable.",
    });
  }

  if (value.outcomeType === "no-survivors" && value.validationGaps.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validationGaps"],
      message: "no-survivors reviews require validationGaps to be empty.",
    });
  }

  if (
    value.outcomeType === "completed-with-validation-gaps" &&
    value.validationPosture !== "validation-gaps"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validationPosture"],
      message:
        "completed-with-validation-gaps reviews require validationPosture to be validation-gaps.",
    });
  }

  if (value.outcomeType === "no-survivors" && value.validationPosture === "validation-gaps") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validationPosture"],
      message: "no-survivors reviews cannot use validation-gaps validationPosture.",
    });
  }

  if (
    value.outcomeType === "external-research-required" &&
    value.validationPosture !== "validation-gaps"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validationPosture"],
      message:
        "external-research-required reviews require validationPosture to be validation-gaps.",
    });
  }

  if (
    (value.outcomeType === "needs-clarification" ||
      value.outcomeType === "abstained-before-execution") &&
    value.validationPosture !== "unknown"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validationPosture"],
      message: `${value.outcomeType} reviews require validationPosture to be unknown.`,
    });
  }

  const expectedBlockedOutcomeType = value.preflightDecision
    ? getBlockedReviewOutcomeType(value.preflightDecision)
    : undefined;
  if (expectedBlockedOutcomeType && value.outcomeType !== expectedBlockedOutcomeType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcomeType"],
      message: `preflightDecision ${value.preflightDecision} requires outcomeType ${expectedBlockedOutcomeType}.`,
    });
  }

  if (
    value.preflightDecision === "proceed" &&
    (value.outcomeType === "needs-clarification" ||
      value.outcomeType === "external-research-required" ||
      value.outcomeType === "abstained-before-execution")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcomeType"],
      message: "preflightDecision proceed cannot use a blocked preflight outcomeType.",
    });
  }
}
