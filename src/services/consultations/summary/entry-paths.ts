import { toDisplayPath } from "../shared.js";
import type { ConsultationSummaryContext, ConsultationSummaryPathState } from "./types.js";

export function buildConsultationSummaryEntryPathLines(
  context: ConsultationSummaryContext,
  pathState: ConsultationSummaryPathState,
): string[] {
  const { projectRoot, runPaths } = context;

  return [
    "Entry paths:",
    `- consultation root: ${toDisplayPath(projectRoot, runPaths.runDir)}`,
    pathState.consultationPlanSummaryPath
      ? `- consultation plan: ${toDisplayPath(projectRoot, pathState.consultationPlanSummaryPath)}`
      : "- consultation plan: not available",
    pathState.consultationPlanMarkdownSummaryPath
      ? `- consultation plan summary: ${toDisplayPath(projectRoot, pathState.consultationPlanMarkdownSummaryPath)}`
      : "- consultation plan summary: not available",
    pathState.preflightReadinessSummaryPath
      ? `- preflight readiness: ${toDisplayPath(projectRoot, pathState.preflightReadinessSummaryPath)}`
      : "- preflight readiness: not available",
    pathState.clarifyFollowUpSummaryPath
      ? `- clarify follow-up: ${toDisplayPath(projectRoot, pathState.clarifyFollowUpSummaryPath)}`
      : "- clarify follow-up: not available",
    pathState.researchBriefSummaryPath
      ? `- research brief: ${toDisplayPath(projectRoot, pathState.researchBriefSummaryPath)}`
      : "- research brief: not available",
    pathState.failureAnalysisSummaryPath
      ? `- failure analysis: ${toDisplayPath(projectRoot, pathState.failureAnalysisSummaryPath)}`
      : "- failure analysis: not available",
    pathState.profileSelectionSummaryPath
      ? `- profile selection: ${toDisplayPath(projectRoot, pathState.profileSelectionSummaryPath)}`
      : "- profile selection: not available",
    pathState.comparisonReportSummaryPath
      ? `- comparison report: ${toDisplayPath(projectRoot, pathState.comparisonReportSummaryPath)}`
      : "- comparison report: not available yet",
    pathState.winnerSelectionSummaryPath
      ? `- winner selection: ${toDisplayPath(projectRoot, pathState.winnerSelectionSummaryPath)}`
      : "- winner selection: not available yet",
    pathState.secondOpinionWinnerSelectionSummaryPath
      ? `- second-opinion winner selection: ${toDisplayPath(projectRoot, pathState.secondOpinionWinnerSelectionSummaryPath)}`
      : "- second-opinion winner selection: not available",
    pathState.hasCrowningRecord
      ? `- crowning record: ${toDisplayPath(projectRoot, pathState.exportPlanPath)}`
      : "- crowning record: not created yet",
  ];
}
