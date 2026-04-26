import type { z } from "zod";

import type { agentJudgeResultSchema } from "../../../adapters/types.js";
import type {
  consultationClarifyFollowUpSchema,
  consultationPlanReadinessSchema,
  consultationPlanReviewSchema,
  planConsensusArtifactSchema,
  RunManifest,
} from "../../../domain/run.js";
import type { secondOpinionWinnerSelectionArtifactSchema } from "../../finalist-judge.js";
import type { comparisonReportSchema } from "../../finalist-report.js";

export interface VerdictReviewArtifactPaths {
  consultationRoot?: string | undefined;
  planningSourceRunId?: string | undefined;
  planningSourceConsultationPlanPath?: string | undefined;
  configPath?: string | undefined;
  consultationPlanReadinessPath?: string | undefined;
  consultationPlanReviewPath?: string | undefined;
  planConsensusPath?: string | undefined;
  preflightReadinessPath?: string | undefined;
  clarifyFollowUpPath?: string | undefined;
  researchBriefPath?: string | undefined;
  failureAnalysisPath?: string | undefined;
  profileSelectionPath?: string | undefined;
  comparisonJsonPath?: string | undefined;
  comparisonMarkdownPath?: string | undefined;
  winnerSelectionPath?: string | undefined;
  secondOpinionWinnerSelectionPath?: string | undefined;
  crowningRecordPath?: string | undefined;
}

export interface LoadedVerdictReviewArtifacts {
  clarifyFollowUp?: z.infer<typeof consultationClarifyFollowUpSchema>;
  comparisonMarkdownAvailable: boolean;
  comparisonReport?: z.infer<typeof comparisonReportSchema>;
  consultationPlanReadiness?: z.infer<typeof consultationPlanReadinessSchema>;
  consultationPlanReview?: z.infer<typeof consultationPlanReviewSchema>;
  exportPlan?: unknown;
  failureAnalysis?: unknown;
  hasExportedCandidate: boolean;
  planConsensus?: z.infer<typeof planConsensusArtifactSchema>;
  preflightReadiness?: unknown;
  profileSelectionArtifact?: unknown;
  researchBrief?: unknown;
  secondOpinionWinnerSelection?: z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>;
  winnerSelection?: z.infer<typeof agentJudgeResultSchema>;
}

export interface VerdictReviewDerivedState {
  candidateStateCounts: Record<string, number>;
  finalistIds: string[];
  judgingCriteria?: string[];
  manualCrowningCandidateIds: string[];
  manualCrowningReason?: string;
  manualReviewRecommended: boolean;
  recommendationAbsenceReason?: string;
  recommendationSummary?: string;
  researchRerunInputPath?: string;
  researchRerunRecommended: boolean;
  reviewFinalistIds: string[];
  status: ReturnType<typeof import("../../../domain/run.js").buildSavedConsultationStatus>;
  validationGaps: string[];
  validationSignals: string[];
  validationSummary?: string;
}

export interface VerdictReviewEvidenceOptions {
  clarifyFollowUp?: z.infer<typeof consultationClarifyFollowUpSchema>;
  comparisonReport?: z.infer<typeof comparisonReportSchema>;
  manifest: RunManifest;
  recommendationAbsenceReason?: string;
  reviewFinalistIds: string[];
  secondOpinionWinnerSelection?: z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>;
  status: ReturnType<typeof import("../../../domain/run.js").buildSavedConsultationStatus>;
  validationGaps: string[];
  validationSignals: string[];
  validationSummary?: string;
}
