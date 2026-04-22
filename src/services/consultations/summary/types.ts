import type { buildSavedConsultationStatus, RunManifest } from "../../../domain/run.js";
import type { resolveConsultationArtifacts } from "../../consultation-artifacts.js";
import type { RunStore } from "../../run-store.js";
import type { ConsultationSurface } from "../shared.js";

export type ConsultationSummaryStatus = ReturnType<typeof buildSavedConsultationStatus>;
export type ConsultationArtifacts = Awaited<ReturnType<typeof resolveConsultationArtifacts>>;
export type ConsultationRunPaths = ReturnType<RunStore["getRunPaths"]>;

export interface ConsultationSummaryContext {
  crownCommand: string;
  crownableResultLabel: string;
  cwd: string;
  finalists: RunManifest["candidates"];
  hasExplicitResultIntent: boolean;
  manifest: RunManifest;
  options?: {
    surface?: ConsultationSurface;
  };
  projectRoot: string;
  recommendedCandidateId?: string;
  recommendedResultLabel: string;
  resolvedArtifacts: ConsultationArtifacts;
  runPaths: ConsultationRunPaths;
  status: ConsultationSummaryStatus;
  verdictCommand: string;
}

export interface ConsultationSummaryPathState {
  clarifyFollowUpSummaryPath?: string;
  comparisonReportSummaryPath?: string;
  consultationPlanMarkdownSummaryPath?: string;
  consultationPlanReadinessSummaryPath?: string;
  consultationPlanReviewSummaryPath?: string;
  consultationPlanSummaryPath?: string;
  exportPlanPath: string;
  failureAnalysisSummaryPath?: string;
  hasCrowningRecord: boolean;
  preflightReadinessSummaryPath?: string;
  profileSelectionSummaryPath?: string;
  researchBriefSummaryPath?: string;
  secondOpinionWinnerSelectionSummaryPath?: string;
  winnerSelectionSummaryPath?: string;
}
