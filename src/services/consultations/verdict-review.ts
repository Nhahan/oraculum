import type { VerdictReview } from "../../domain/chat-native.js";
import {
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  type RunManifest,
} from "../../domain/run.js";
import { deriveResearchBasisStatus, deriveResearchConflictHandling } from "../../domain/task.js";

import { loadVerdictReviewArtifacts } from "./verdict-review/artifacts.js";
import {
  buildReviewStrongestEvidence,
  buildReviewWeakestEvidence,
} from "./verdict-review/evidence.js";
import {
  buildValidationProfileFields,
  buildVerdictReviewDerivedState,
} from "./verdict-review/state.js";
import type { VerdictReviewArtifactPaths } from "./verdict-review/types.js";

export async function buildVerdictReview(
  manifest: RunManifest,
  artifacts: VerdictReviewArtifactPaths,
): Promise<VerdictReview> {
  const loaded = await loadVerdictReviewArtifacts(manifest, artifacts);
  const derived = buildVerdictReviewDerivedState(manifest, artifacts, loaded);
  const strongestEvidence = buildReviewStrongestEvidence({
    ...(loaded.clarifyFollowUp ? { clarifyFollowUp: loaded.clarifyFollowUp } : {}),
    ...(loaded.comparisonReport ? { comparisonReport: loaded.comparisonReport } : {}),
    manifest,
    reviewFinalistIds: derived.reviewFinalistIds,
    ...(loaded.secondOpinionWinnerSelection
      ? { secondOpinionWinnerSelection: loaded.secondOpinionWinnerSelection }
      : {}),
    status: derived.status,
    validationGaps: derived.validationGaps,
    validationSignals: derived.validationSignals,
    ...(derived.validationSummary ? { validationSummary: derived.validationSummary } : {}),
  });
  const weakestEvidence = buildReviewWeakestEvidence({
    ...(loaded.clarifyFollowUp ? { clarifyFollowUp: loaded.clarifyFollowUp } : {}),
    manifest,
    ...(derived.recommendationAbsenceReason
      ? { recommendationAbsenceReason: derived.recommendationAbsenceReason }
      : {}),
    ...(loaded.secondOpinionWinnerSelection
      ? { secondOpinionWinnerSelection: loaded.secondOpinionWinnerSelection }
      : {}),
    status: derived.status,
    validationGaps: derived.validationGaps,
    validationSignals: derived.validationSignals,
    ...(derived.validationSummary ? { validationSummary: derived.validationSummary } : {}),
    reviewFinalistIds: derived.reviewFinalistIds,
  });
  const validationFields = buildValidationProfileFields(manifest);

  return {
    outcomeType: derived.status.outcomeType,
    outcomeSummary: describeConsultationOutcomeSummary({
      outcomeType: derived.status.outcomeType,
      ...(manifest.taskPacket.artifactKind
        ? { taskArtifactKind: manifest.taskPacket.artifactKind }
        : {}),
      ...(manifest.taskPacket.targetArtifactPath
        ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
        : {}),
    }),
    verificationLevel: derived.status.verificationLevel,
    validationPosture: derived.status.validationPosture,
    judgingBasisKind: derived.status.judgingBasisKind,
    judgingBasisSummary: describeConsultationJudgingBasisSummary(derived.status.judgingBasisKind),
    taskSourceKind: manifest.taskPacket.sourceKind,
    taskSourcePath: manifest.taskPacket.sourcePath,
    ...(manifest.taskPacket.artifactKind
      ? { taskArtifactKind: manifest.taskPacket.artifactKind }
      : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
      : {}),
    ...(manifest.taskPacket.researchContext?.summary
      ? { researchSummary: manifest.taskPacket.researchContext.summary }
      : {}),
    ...(manifest.taskPacket.researchContext?.confidence
      ? { researchConfidence: manifest.taskPacket.researchContext.confidence }
      : {}),
    researchBasisStatus: deriveResearchBasisStatus({
      researchContext: manifest.taskPacket.researchContext,
      researchBasisDrift: manifest.preflight?.researchBasisDrift,
    }),
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
    researchRerunRecommended: derived.researchRerunRecommended,
    ...(derived.researchRerunInputPath
      ? { researchRerunInputPath: derived.researchRerunInputPath }
      : {}),
    researchSourceCount: manifest.taskPacket.researchContext?.sources.length ?? 0,
    researchClaimCount: manifest.taskPacket.researchContext?.claims.length ?? 0,
    researchVersionNoteCount: manifest.taskPacket.researchContext?.versionNotes.length ?? 0,
    researchConflictCount: manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0,
    researchConflictsPresent:
      (manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0) > 0,
    ...(manifest.taskPacket.originKind && manifest.taskPacket.originPath
      ? {
          taskOriginSourceKind: manifest.taskPacket.originKind,
          taskOriginSourcePath: manifest.taskPacket.originPath,
        }
      : {}),
    ...(derived.status.recommendedCandidateId
      ? { recommendedCandidateId: derived.status.recommendedCandidateId }
      : {}),
    finalistIds: derived.reviewFinalistIds,
    strongestEvidence,
    weakestEvidence,
    secondOpinionTriggerKinds: loaded.secondOpinionWinnerSelection?.triggerKinds ?? [],
    secondOpinionTriggerReasons: loaded.secondOpinionWinnerSelection?.triggerReasons ?? [],
    ...(derived.judgingCriteria?.length ? { judgingCriteria: derived.judgingCriteria } : {}),
    ...(derived.recommendationSummary
      ? { recommendationSummary: derived.recommendationSummary }
      : {}),
    ...(derived.recommendationAbsenceReason
      ? { recommendationAbsenceReason: derived.recommendationAbsenceReason }
      : {}),
    ...(loaded.secondOpinionWinnerSelection
      ? {
          secondOpinionAdapter: loaded.secondOpinionWinnerSelection.adapter,
          secondOpinionAgreement: loaded.secondOpinionWinnerSelection.agreement,
          secondOpinionSummary: loaded.secondOpinionWinnerSelection.advisorySummary,
        }
      : {}),
    ...(loaded.secondOpinionWinnerSelection?.result?.recommendation?.decision
      ? {
          secondOpinionDecision: loaded.secondOpinionWinnerSelection.result.recommendation.decision,
        }
      : {}),
    ...(loaded.secondOpinionWinnerSelection?.result?.recommendation?.candidateId
      ? {
          secondOpinionCandidateId:
            loaded.secondOpinionWinnerSelection.result.recommendation.candidateId,
        }
      : {}),
    ...(loaded.secondOpinionWinnerSelection?.result?.recommendation?.confidence
      ? {
          secondOpinionConfidence:
            loaded.secondOpinionWinnerSelection.result.recommendation.confidence,
        }
      : {}),
    manualReviewRecommended: derived.manualReviewRecommended,
    manualCrowningCandidateIds: derived.manualCrowningCandidateIds,
    ...(derived.manualCrowningReason ? { manualCrowningReason: derived.manualCrowningReason } : {}),
    ...validationFields,
    ...(loaded.consultationPlanReadiness
      ? {
          planReadinessStatus: loaded.consultationPlanReadiness.status,
          planReadyForConsult: loaded.consultationPlanReadiness.readyForConsult,
          planReviewStatus: loaded.consultationPlanReadiness.reviewStatus,
          planStaleBasis: loaded.consultationPlanReadiness.staleBasis,
          planMissingOracleIds: loaded.consultationPlanReadiness.missingOracleIds,
          planOpenQuestions: loaded.consultationPlanReadiness.unresolvedQuestions,
          planNextAction: loaded.consultationPlanReadiness.nextAction,
        }
      : {}),
    ...(loaded.consultationPlanReview
      ? { planReviewSummary: loaded.consultationPlanReview.summary }
      : {}),
    ...(manifest.preflight?.decision ? { preflightDecision: manifest.preflight.decision } : {}),
    researchPosture: derived.status.researchPosture,
    ...(manifest.preflight?.clarificationQuestion
      ? { clarificationQuestion: manifest.preflight.clarificationQuestion }
      : {}),
    ...(manifest.preflight?.researchQuestion
      ? { researchQuestion: manifest.preflight.researchQuestion }
      : {}),
    ...(loaded.clarifyFollowUp ? { clarifyScopeKeyType: loaded.clarifyFollowUp.scopeKeyType } : {}),
    ...(loaded.clarifyFollowUp ? { clarifyScopeKey: loaded.clarifyFollowUp.scopeKey } : {}),
    ...(loaded.clarifyFollowUp
      ? { clarifyRepeatedCaseCount: loaded.clarifyFollowUp.repeatedCaseCount }
      : {}),
    ...(loaded.clarifyFollowUp
      ? { clarifyFollowUpQuestion: loaded.clarifyFollowUp.keyQuestion }
      : {}),
    ...(loaded.clarifyFollowUp
      ? { clarifyMissingResultContract: loaded.clarifyFollowUp.missingResultContract }
      : {}),
    ...(loaded.clarifyFollowUp
      ? { clarifyMissingJudgingBasis: loaded.clarifyFollowUp.missingJudgingBasis }
      : {}),
    artifactAvailability: {
      ...(loaded.consultationPlanReadiness ? { planReadiness: true } : {}),
      ...(loaded.consultationPlanReview ? { planReview: true } : {}),
      preflightReadiness: Boolean(loaded.preflightReadiness),
      clarifyFollowUp: Boolean(loaded.clarifyFollowUp),
      researchBrief: Boolean(loaded.researchBrief),
      failureAnalysis: Boolean(loaded.failureAnalysis),
      profileSelection: Boolean(loaded.profileSelectionArtifact),
      comparisonReport: Boolean(loaded.comparisonReport || loaded.comparisonMarkdownAvailable),
      winnerSelection: Boolean(loaded.winnerSelection),
      secondOpinionWinnerSelection: Boolean(loaded.secondOpinionWinnerSelection),
      crowningRecord: loaded.hasExportedCandidate && Boolean(loaded.exportPlan),
    },
    candidateStateCounts: derived.candidateStateCounts,
  };
}
