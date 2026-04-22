import type { ConsultationSummaryContext, ConsultationSummaryPathState } from "./types.js";

export function buildConsultationSummaryPathState(
  context: ConsultationSummaryContext,
): ConsultationSummaryPathState {
  const { resolvedArtifacts, runPaths } = context;
  const comparisonReportSummaryPath = resolvedArtifacts.comparisonMarkdownPath
    ? resolvedArtifacts.comparisonMarkdownPath
    : resolvedArtifacts.comparisonJsonPath;
  const preflightReadinessSummaryPath =
    resolvedArtifacts.preflightReadiness && resolvedArtifacts.preflightReadinessPath
      ? resolvedArtifacts.preflightReadinessPath
      : undefined;
  const consultationPlanSummaryPath =
    resolvedArtifacts.consultationPlan && resolvedArtifacts.consultationPlanPath
      ? resolvedArtifacts.consultationPlanPath
      : undefined;
  const consultationPlanReadinessSummaryPath =
    resolvedArtifacts.consultationPlanReadiness && resolvedArtifacts.consultationPlanReadinessPath
      ? resolvedArtifacts.consultationPlanReadinessPath
      : undefined;
  const consultationPlanReviewSummaryPath =
    resolvedArtifacts.consultationPlanReview && resolvedArtifacts.consultationPlanReviewPath
      ? resolvedArtifacts.consultationPlanReviewPath
      : undefined;
  const clarifyFollowUpSummaryPath =
    resolvedArtifacts.clarifyFollowUp && resolvedArtifacts.clarifyFollowUpPath
      ? resolvedArtifacts.clarifyFollowUpPath
      : undefined;
  const researchBriefSummaryPath =
    resolvedArtifacts.researchBrief && resolvedArtifacts.researchBriefPath
      ? resolvedArtifacts.researchBriefPath
      : undefined;
  const failureAnalysisSummaryPath =
    resolvedArtifacts.failureAnalysis && resolvedArtifacts.failureAnalysisPath
      ? resolvedArtifacts.failureAnalysisPath
      : undefined;
  const profileSelectionSummaryPath =
    resolvedArtifacts.profileSelection && resolvedArtifacts.profileSelectionPath
      ? resolvedArtifacts.profileSelectionPath
      : undefined;
  const winnerSelectionSummaryPath =
    resolvedArtifacts.winnerSelection && resolvedArtifacts.winnerSelectionPath
      ? resolvedArtifacts.winnerSelectionPath
      : undefined;
  const secondOpinionWinnerSelectionSummaryPath =
    resolvedArtifacts.secondOpinionWinnerSelection &&
    resolvedArtifacts.secondOpinionWinnerSelectionPath
      ? resolvedArtifacts.secondOpinionWinnerSelectionPath
      : undefined;

  return {
    exportPlanPath: runPaths.exportPlanPath,
    hasCrowningRecord: resolvedArtifacts.crowningRecordAvailable,
    ...(clarifyFollowUpSummaryPath ? { clarifyFollowUpSummaryPath } : {}),
    ...(comparisonReportSummaryPath ? { comparisonReportSummaryPath } : {}),
    ...(resolvedArtifacts.consultationPlanMarkdownPath
      ? { consultationPlanMarkdownSummaryPath: resolvedArtifacts.consultationPlanMarkdownPath }
      : {}),
    ...(consultationPlanSummaryPath ? { consultationPlanSummaryPath } : {}),
    ...(consultationPlanReadinessSummaryPath ? { consultationPlanReadinessSummaryPath } : {}),
    ...(consultationPlanReviewSummaryPath ? { consultationPlanReviewSummaryPath } : {}),
    ...(failureAnalysisSummaryPath ? { failureAnalysisSummaryPath } : {}),
    ...(preflightReadinessSummaryPath ? { preflightReadinessSummaryPath } : {}),
    ...(profileSelectionSummaryPath ? { profileSelectionSummaryPath } : {}),
    ...(researchBriefSummaryPath ? { researchBriefSummaryPath } : {}),
    ...(secondOpinionWinnerSelectionSummaryPath ? { secondOpinionWinnerSelectionSummaryPath } : {}),
    ...(winnerSelectionSummaryPath ? { winnerSelectionSummaryPath } : {}),
  };
}
