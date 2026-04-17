import type { z } from "zod";

import {
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
} from "../../../run.js";
import { stringArrayMembersEqual } from "../../../schema-compat.js";
import type { VerdictReviewObject } from "../review-shape.js";
import { addVerdictReviewIssue } from "./shared.js";

export function refineVerdictReviewAliases(
  value: VerdictReviewObject,
  context: z.RefinementCtx,
): void {
  if (
    value.profileId &&
    value.validationProfileId &&
    value.profileId !== value.validationProfileId
  ) {
    addVerdictReviewIssue(
      context,
      ["profileId"],
      "profileId must match validationProfileId when both legacy and validation aliases are present.",
    );
  }

  if (
    value.profileMissingCapabilities &&
    !stringArrayMembersEqual(value.profileMissingCapabilities, value.validationGaps)
  ) {
    addVerdictReviewIssue(
      context,
      ["profileMissingCapabilities"],
      "profileMissingCapabilities must match validationGaps when both legacy and validation aliases are present.",
    );
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
    addVerdictReviewIssue(
      context,
      ["outcomeSummary"],
      "outcomeSummary must match outcomeType and task artifact context when present.",
    );
  }

  if (
    value.judgingBasisSummary &&
    value.judgingBasisSummary !== describeConsultationJudgingBasisSummary(value.judgingBasisKind)
  ) {
    addVerdictReviewIssue(
      context,
      ["judgingBasisSummary"],
      "judgingBasisSummary must match judgingBasisKind when present.",
    );
  }

  if (value.researchBasisStatus === "stale" && value.researchBasisDrift !== true) {
    addVerdictReviewIssue(
      context,
      ["researchBasisStatus"],
      "researchBasisStatus stale requires researchBasisDrift to be true.",
    );
  }

  if (
    value.researchConflictHandling === "manual-review-required" &&
    !value.researchConflictsPresent
  ) {
    addVerdictReviewIssue(
      context,
      ["researchConflictHandling"],
      "researchConflictHandling manual-review-required requires researchConflictsPresent to be true.",
    );
  }

  if (
    value.researchConflictsPresent &&
    value.researchConflictHandling &&
    value.researchConflictHandling !== "manual-review-required"
  ) {
    addVerdictReviewIssue(
      context,
      ["researchConflictHandling"],
      "researchConflictHandling must be manual-review-required when researchConflictsPresent is true.",
    );
  }
}
