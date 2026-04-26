import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../profile.js";
import {
  deriveResearchBasisStatus,
  deriveResearchConflictHandling,
  describeRecommendedTaskResultLabel,
} from "../task.js";

import { deriveConsultationOutcomeForManifest } from "./outcome.js";
import {
  type ConsultationNextAction,
  type ConsultationOutcome,
  type RunManifest,
  type SavedConsultationStatus,
  savedConsultationStatusSchema,
} from "./schema.js";

export function buildSavedConsultationStatus(
  manifest: RunManifest,
  options?: {
    comparisonReportAvailable?: boolean;
    crowningRecordAvailable?: boolean;
    manualReviewRequired?: boolean;
  },
): SavedConsultationStatus {
  const outcome = manifest.outcome ?? deriveConsultationOutcomeForManifest(manifest);
  const nextActions = buildConsultationNextActions(outcome, {
    ...(options?.comparisonReportAvailable !== undefined
      ? { comparisonReportAvailable: options.comparisonReportAvailable }
      : {}),
    ...(options?.crowningRecordAvailable !== undefined
      ? { crowningRecordAvailable: options.crowningRecordAvailable }
      : {}),
    ...(options?.manualReviewRequired !== undefined
      ? { manualReviewRequired: options.manualReviewRequired }
      : {}),
    researchBasisDrift: manifest.preflight?.researchBasisDrift === true,
  });
  const researchRerunInputPath =
    manifest.taskPacket.sourceKind === "research-brief"
      ? manifest.taskPacket.sourcePath
      : undefined;
  const researchRerunRecommended =
    outcome.type === "external-research-required" ||
    manifest.preflight?.researchBasisDrift === true;
  const researchBasisStatus = deriveResearchBasisStatus({
    researchContext: manifest.taskPacket.researchContext,
    researchBasisDrift: manifest.preflight?.researchBasisDrift,
  });

  return savedConsultationStatusSchema.parse({
    consultationId: manifest.id,
    consultationState: manifest.status,
    outcomeType: outcome.type,
    terminal: outcome.terminal,
    crownable: outcome.crownable,
    taskSourceKind: manifest.taskPacket.sourceKind,
    taskSourcePath: manifest.taskPacket.sourcePath,
    ...(manifest.taskPacket.artifactKind
      ? { taskArtifactKind: manifest.taskPacket.artifactKind }
      : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
      : {}),
    ...(manifest.taskPacket.researchContext?.confidence
      ? { researchConfidence: manifest.taskPacket.researchContext.confidence }
      : {}),
    researchBasisStatus,
    ...(manifest.taskPacket.researchContext
      ? {
          researchConflictHandling:
            manifest.taskPacket.researchContext.conflictHandling ??
            deriveResearchConflictHandling(manifest.taskPacket.researchContext.unresolvedConflicts),
        }
      : {}),
    researchSignalCount: manifest.taskPacket.researchContext?.signalSummary.length ?? 0,
    ...(manifest.taskPacket.researchContext?.signalFingerprint
      ? { researchSignalFingerprint: manifest.taskPacket.researchContext.signalFingerprint }
      : {}),
    ...(manifest.preflight?.researchBasisDrift !== undefined
      ? { researchBasisDrift: manifest.preflight.researchBasisDrift }
      : {}),
    researchRerunRecommended,
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    researchConflictsPresent:
      (manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0) > 0,
    ...(manifest.taskPacket.originKind && manifest.taskPacket.originPath
      ? {
          taskOriginSourceKind: manifest.taskPacket.originKind,
          taskOriginSourcePath: manifest.taskPacket.originPath,
        }
      : {}),
    validationPosture: outcome.validationPosture,
    ...(getValidationProfileId(manifest.profileSelection)
      ? { validationProfileId: getValidationProfileId(manifest.profileSelection) }
      : {}),
    ...(getValidationSummary(manifest.profileSelection)
      ? { validationSummary: getValidationSummary(manifest.profileSelection) }
      : {}),
    validationSignals: getValidationSignals(manifest.profileSelection),
    validationGaps: getValidationGaps(manifest.profileSelection),
    ...(outcome.recommendedCandidateId
      ? { recommendedCandidateId: outcome.recommendedCandidateId }
      : {}),
    finalistCount: outcome.finalistCount,
    validationGapsPresent: outcome.validationGapCount > 0,
    judgingBasisKind: outcome.judgingBasisKind,
    verificationLevel: outcome.verificationLevel,
    ...(manifest.preflight ? { preflightDecision: manifest.preflight.decision } : {}),
    researchPosture: manifest.preflight?.researchPosture ?? "unknown",
    nextActions,
    updatedAt: manifest.updatedAt ?? manifest.createdAt,
  });
}

export function describeConsultationOutcomeSummary(options: {
  outcomeType: ConsultationOutcome["type"];
  taskArtifactKind?: string | undefined;
  targetArtifactPath?: string | undefined;
}): string {
  const recommendedResultLabel = describeRecommendedTaskResultLabel({
    ...(options.taskArtifactKind ? { artifactKind: options.taskArtifactKind } : {}),
    ...(options.targetArtifactPath ? { targetArtifactPath: options.targetArtifactPath } : {}),
  });
  const hasExplicitResultIntent =
    options.taskArtifactKind !== undefined || options.targetArtifactPath !== undefined;

  switch (options.outcomeType) {
    case "pending-execution":
      return "Candidate execution has not started yet.";
    case "running":
      return "Candidate execution is still in progress.";
    case "needs-clarification":
      return "Execution stopped because clarification is still required before candidate generation.";
    case "external-research-required":
      return "Execution stopped because bounded external research is required before candidate generation.";
    case "abstained-before-execution":
      return "Execution was declined before candidate generation.";
    case "recommended-survivor":
      return capitalizeSentence(`${recommendedResultLabel} was selected.`);
    case "finalists-without-recommendation":
      return `Finalists survived, but no ${recommendedResultLabel} was recorded.`;
    case "completed-with-validation-gaps":
      return hasExplicitResultIntent
        ? `Execution completed, but validation gaps still block a ${recommendedResultLabel}.`
        : "Execution completed, but validation gaps still block a safe recommendation.";
    case "no-survivors":
      return hasExplicitResultIntent
        ? `No ${recommendedResultLabel} emerged from the consultation.`
        : "No survivors advanced after the oracle rounds.";
  }
}

export function describeConsultationJudgingBasisSummary(
  judgingBasisKind: ConsultationOutcome["judgingBasisKind"],
): string {
  switch (judgingBasisKind) {
    case "repo-local-oracle":
      return "Judged with repo-local validation oracles.";
    case "missing-capability":
      return "Judged against validation-gap and missing-capability evidence.";
    case "unknown":
      return "No explicit repo-local oracle or missing-capability basis was recorded.";
  }
}

function buildConsultationNextActions(
  outcome: ConsultationOutcome,
  options?: {
    comparisonReportAvailable?: boolean;
    crowningRecordAvailable?: boolean;
    manualReviewRequired?: boolean;
    researchBasisDrift?: boolean;
  },
): ConsultationNextAction[] {
  const actions = new Set<ConsultationNextAction>(["reopen-verdict"]);

  if (options?.manualReviewRequired === true) {
    actions.add("perform-manual-review");
  }

  switch (outcome.type) {
    case "needs-clarification":
      actions.add("review-preflight-readiness");
      actions.add("answer-clarification-and-rerun");
      break;
    case "external-research-required":
      actions.add("review-preflight-readiness");
      actions.add("gather-external-research-and-rerun");
      actions.add("rerun-with-research-brief");
      break;
    case "abstained-before-execution":
      actions.add("review-preflight-readiness");
      actions.add("revise-task-and-rerun");
      break;
    case "recommended-survivor":
      if (options?.manualReviewRequired !== true && options?.crowningRecordAvailable !== true) {
        actions.add("crown-recommended-result");
      }
      break;
    case "finalists-without-recommendation":
      if (options?.comparisonReportAvailable !== false) {
        actions.add("inspect-comparison-report");
      }
      actions.add("rerun-with-different-candidate-count");
      break;
    case "completed-with-validation-gaps":
      if (options?.comparisonReportAvailable !== false) {
        actions.add("inspect-comparison-report");
      }
      actions.add("review-validation-gaps");
      actions.add("add-repo-local-oracle");
      actions.add("rerun-with-different-candidate-count");
      break;
    case "no-survivors":
      if (options?.comparisonReportAvailable !== false) {
        actions.add("inspect-comparison-report");
      }
      actions.add("rerun-with-different-candidate-count");
      break;
    case "pending-execution":
    case "running":
      break;
  }

  if (outcome.validationGapCount > 0) {
    actions.add("review-validation-gaps");
    actions.add("add-repo-local-oracle");
  }
  if (options?.researchBasisDrift) {
    actions.add("refresh-stale-research-and-rerun");
  }

  return [...actions];
}

function capitalizeSentence(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
