import type { z } from "zod";

import type { agentJudgeResultSchema } from "../../adapters/types.js";
import type { consultationProfileSelectionArtifactSchema } from "../../domain/profile.js";
import type {
  consultationClarifyFollowUpSchema,
  consultationPlanArtifactSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../../domain/run.js";
import type { failureAnalysisSchema } from "../failure-analysis.js";
import type { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";
import type { comparisonReportSchema } from "../finalist-report.js";

export interface ConsultationArtifactPaths {
  consultationRoot: string;
  configPath?: string;
  consultationPlanPath?: string;
  consultationPlanMarkdownPath?: string;
  preflightReadinessPath?: string;
  clarifyFollowUpPath?: string;
  researchBriefPath?: string;
  failureAnalysisPath?: string;
  profileSelectionPath?: string;
  comparisonJsonPath?: string;
  comparisonMarkdownPath?: string;
  winnerSelectionPath?: string;
  secondOpinionWinnerSelectionPath?: string;
  crowningRecordPath?: string;
}

export interface ConsultationArtifactState extends ConsultationArtifactPaths {
  consultationPlan?: z.infer<typeof consultationPlanArtifactSchema>;
  preflightReadiness?: z.infer<typeof consultationPreflightReadinessArtifactSchema>;
  clarifyFollowUp?: z.infer<typeof consultationClarifyFollowUpSchema>;
  researchBrief?: z.infer<typeof consultationResearchBriefSchema>;
  failureAnalysis?: z.infer<typeof failureAnalysisSchema>;
  profileSelection?: z.infer<typeof consultationProfileSelectionArtifactSchema>;
  comparisonReport?: z.infer<typeof comparisonReportSchema>;
  winnerSelection?: z.infer<typeof agentJudgeResultSchema>;
  secondOpinionWinnerSelection?: z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>;
  crowningRecord?: z.infer<typeof exportPlanSchema>;
  comparisonReportAvailable: boolean;
  manualReviewRequired: boolean;
  crowningRecordAvailable: boolean;
  hasExportedCandidate: boolean;
}

export interface LoadedConsultationArtifacts {
  consultationPlan: z.infer<typeof consultationPlanArtifactSchema> | undefined;
  consultationPlanMarkdownAvailable: boolean;
  preflightReadiness: z.infer<typeof consultationPreflightReadinessArtifactSchema> | undefined;
  clarifyFollowUp: z.infer<typeof consultationClarifyFollowUpSchema> | undefined;
  researchBrief: z.infer<typeof consultationResearchBriefSchema> | undefined;
  failureAnalysis: z.infer<typeof failureAnalysisSchema> | undefined;
  profileSelection: z.infer<typeof consultationProfileSelectionArtifactSchema> | undefined;
  comparisonReport: z.infer<typeof comparisonReportSchema> | undefined;
  comparisonMarkdownAvailable: boolean;
  winnerSelection: z.infer<typeof agentJudgeResultSchema> | undefined;
  secondOpinionWinnerSelection:
    | z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>
    | undefined;
  crowningRecord: z.infer<typeof exportPlanSchema> | undefined;
}
