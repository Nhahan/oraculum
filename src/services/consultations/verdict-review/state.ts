import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../../domain/profile.js";
import { buildSavedConsultationStatus, type RunManifest } from "../../../domain/run.js";
import {
  isPlanConsensusRemediationEligible,
  summarizePlanConsensusBlocker,
} from "../../plan-consensus/index.js";
import type {
  LoadedVerdictReviewArtifacts,
  VerdictReviewArtifactPaths,
  VerdictReviewDerivedState,
} from "./types.js";

export function buildVerdictReviewDerivedState(
  manifest: RunManifest,
  artifacts: VerdictReviewArtifactPaths,
  loaded: LoadedVerdictReviewArtifacts,
): VerdictReviewDerivedState {
  const status = buildSavedConsultationStatus(manifest, {
    comparisonReportAvailable: Boolean(
      loaded.comparisonReport || loaded.comparisonMarkdownAvailable,
    ),
    crowningRecordAvailable: Boolean(loaded.hasExportedCandidate && loaded.exportPlan),
    ...(loaded.secondOpinionWinnerSelection &&
    loaded.secondOpinionWinnerSelection.agreement !== "agrees-select"
      ? { manualReviewRequired: true }
      : {}),
    planConclaveRemediationRecommended: loaded.planConsensus
      ? isPlanConsensusRemediationEligible(loaded.planConsensus)
      : false,
  });
  const researchRerunInputPath =
    manifest.taskPacket.sourceKind === "research-brief"
      ? manifest.taskPacket.sourcePath
      : loaded.researchBrief
        ? artifacts.researchBriefPath
        : undefined;
  const researchRerunRecommended =
    status.outcomeType === "external-research-required" || status.researchBasisDrift === true;
  const candidateStateCounts = manifest.candidates.reduce<Record<string, number>>(
    (counts, candidate) => {
      counts[candidate.status] = (counts[candidate.status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const finalistIds = manifest.candidates
    .filter((candidate) => candidate.status === "promoted" || candidate.status === "exported")
    .map((candidate) => candidate.id);
  const reviewFinalistIds =
    finalistIds.length === 0 &&
    status.outcomeType === "recommended-survivor" &&
    status.recommendedCandidateId
      ? [status.recommendedCandidateId]
      : finalistIds;
  const validationSummary = getValidationSummary(manifest.profileSelection);
  const validationSignals = getValidationSignals(manifest.profileSelection);
  const validationGaps = getValidationGaps(manifest.profileSelection);
  const recommendationSummary =
    status.outcomeType === "recommended-survivor"
      ? (loaded.comparisonReport?.whyThisWon ?? manifest.recommendedWinner?.summary)
      : undefined;
  const judgingCriteria = loaded.winnerSelection?.recommendation?.judgingCriteria;
  const recommendationAbsenceReason = buildRecommendationAbsenceReason({
    planConsensus: loaded.planConsensus,
    status,
    validationGaps,
    winnerSelection: loaded.winnerSelection,
  });
  const manualCrowningCandidateIds =
    status.outcomeType === "finalists-without-recommendation" ? reviewFinalistIds : [];
  const manualReviewRecommended =
    status.outcomeType === "finalists-without-recommendation" ||
    status.outcomeType === "completed-with-validation-gaps" ||
    status.outcomeType === "needs-clarification" ||
    status.outcomeType === "external-research-required" ||
    (status.outcomeType === "recommended-survivor" &&
      Boolean(
        loaded.secondOpinionWinnerSelection &&
          loaded.secondOpinionWinnerSelection.agreement !== "agrees-select",
      ));
  const manualCrowningReason =
    manualCrowningCandidateIds.length > 0
      ? "Finalists survived without a recorded recommendation; manual crowning requires operator judgment."
      : undefined;

  return {
    candidateStateCounts,
    finalistIds,
    ...(judgingCriteria?.length ? { judgingCriteria } : {}),
    manualCrowningCandidateIds,
    ...(manualCrowningReason ? { manualCrowningReason } : {}),
    manualReviewRecommended,
    ...(recommendationAbsenceReason ? { recommendationAbsenceReason } : {}),
    ...(recommendationSummary ? { recommendationSummary } : {}),
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    researchRerunRecommended,
    reviewFinalistIds,
    status,
    validationGaps,
    validationSignals,
    ...(validationSummary ? { validationSummary } : {}),
  };
}

function buildRecommendationAbsenceReason(options: {
  planConsensus: LoadedVerdictReviewArtifacts["planConsensus"];
  status: ReturnType<typeof buildSavedConsultationStatus>;
  validationGaps: string[];
  winnerSelection: LoadedVerdictReviewArtifacts["winnerSelection"];
}): string | undefined {
  switch (options.status.outcomeType) {
    case "recommended-survivor":
      return undefined;
    case "finalists-without-recommendation":
      if (options.winnerSelection?.recommendation?.decision === "abstain") {
        return options.winnerSelection.recommendation.summary;
      }
      return "Finalists survived, but no recommendation was recorded.";
    case "completed-with-validation-gaps":
      return options.validationGaps.length > 0
        ? `Validation gaps remain: ${options.validationGaps.join("; ")}.`
        : "Execution completed with unresolved validation gaps.";
    case "no-survivors":
      return "No finalists survived the oracle rounds.";
    case "needs-clarification":
      if (options.planConsensus && !options.planConsensus.approved) {
        const blocker = summarizePlanConsensusBlocker(options.planConsensus);
        const prefix = isPlanConsensusRemediationEligible(options.planConsensus)
          ? "Plan Conclave remediation is required"
          : "Plan Conclave did not approve";
        return `${prefix} (${blocker.blockerKind}): ${blocker.summary}`;
      }
      return "Execution stopped because operator clarification is still required.";
    case "external-research-required":
      return "Execution stopped because bounded external research is still required.";
    case "abstained-before-execution":
      return "Execution was declined before candidate generation.";
    case "pending-execution":
      return "Candidate execution has not started yet.";
    case "running":
      return "Candidate execution is still in progress.";
  }
}

export function buildValidationProfileFields(manifest: RunManifest): {
  validationProfileId?: string;
  validationSummary?: string;
  validationSignals: string[];
  validationGaps: string[];
} {
  const validationProfileId = getValidationProfileId(manifest.profileSelection);
  const validationSummary = getValidationSummary(manifest.profileSelection);
  const validationSignals = getValidationSignals(manifest.profileSelection);
  const validationGaps = getValidationGaps(manifest.profileSelection);

  return {
    ...(validationProfileId ? { validationProfileId } : {}),
    ...(validationSummary ? { validationSummary } : {}),
    validationSignals,
    validationGaps,
  };
}
