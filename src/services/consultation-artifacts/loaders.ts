import { agentJudgeResultSchema } from "../../adapters/types.js";
import { consultationProfileSelectionArtifactSchema } from "../../domain/profile.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPlanArtifactSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../../domain/run.js";
import { failureAnalysisSchema } from "../failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";
import { comparisonReportSchema } from "../finalist-report.js";
import { hasNonEmptyTextArtifact, hasNonEmptyTextArtifactSync } from "../project.js";
import { RunStore } from "../run-store.js";

import {
  hasCurrentComparisonMarkdownArtifact,
  hasCurrentComparisonMarkdownArtifactSync,
} from "./state.js";
import type { ConsultationArtifactPaths, LoadedConsultationArtifacts } from "./types.js";

export async function loadConsultationArtifacts(
  paths: ConsultationArtifactPaths,
  expectedRunId: string | undefined,
): Promise<LoadedConsultationArtifacts> {
  const store = new RunStore(paths.consultationRoot);
  const [
    consultationPlan,
    consultationPlanMarkdownAvailable,
    preflightReadiness,
    clarifyFollowUp,
    researchBrief,
    failureAnalysis,
    profileSelection,
    comparisonReport,
    comparisonMarkdownAvailable,
    winnerSelection,
    secondOpinionWinnerSelection,
    crowningRecord,
  ] = await Promise.all([
    store.readOptionalParsedArtifact(paths.consultationPlanPath, consultationPlanArtifactSchema),
    paths.consultationPlanMarkdownPath
      ? hasNonEmptyTextArtifact(paths.consultationPlanMarkdownPath)
      : Promise.resolve(false),
    store.readOptionalParsedArtifact(
      paths.preflightReadinessPath,
      consultationPreflightReadinessArtifactSchema,
    ),
    store.readOptionalParsedArtifact(paths.clarifyFollowUpPath, consultationClarifyFollowUpSchema),
    store.readOptionalParsedArtifact(paths.researchBriefPath, consultationResearchBriefSchema),
    store.readOptionalParsedArtifact(paths.failureAnalysisPath, failureAnalysisSchema),
    store.readOptionalParsedArtifact(
      paths.profileSelectionPath,
      consultationProfileSelectionArtifactSchema,
    ),
    store.readOptionalParsedArtifact(paths.comparisonJsonPath, comparisonReportSchema),
    paths.comparisonMarkdownPath
      ? hasCurrentComparisonMarkdownArtifact(paths.comparisonMarkdownPath, expectedRunId)
      : Promise.resolve(false),
    store.readOptionalParsedArtifact(paths.winnerSelectionPath, agentJudgeResultSchema),
    store.readOptionalParsedArtifact(
      paths.secondOpinionWinnerSelectionPath,
      secondOpinionWinnerSelectionArtifactSchema,
    ),
    store.readOptionalParsedArtifact(paths.crowningRecordPath, exportPlanSchema),
  ]);

  return {
    consultationPlan,
    consultationPlanMarkdownAvailable,
    preflightReadiness,
    clarifyFollowUp,
    researchBrief,
    failureAnalysis,
    profileSelection,
    comparisonReport,
    comparisonMarkdownAvailable,
    winnerSelection,
    secondOpinionWinnerSelection,
    crowningRecord,
  };
}

export function loadConsultationArtifactsSync(
  paths: ConsultationArtifactPaths,
  expectedRunId: string | undefined,
): LoadedConsultationArtifacts {
  const store = new RunStore(paths.consultationRoot);
  return {
    consultationPlan: store.readOptionalParsedArtifactSync(
      paths.consultationPlanPath,
      consultationPlanArtifactSchema,
    ),
    consultationPlanMarkdownAvailable: paths.consultationPlanMarkdownPath
      ? hasNonEmptyTextArtifactSync(paths.consultationPlanMarkdownPath)
      : false,
    preflightReadiness: store.readOptionalParsedArtifactSync(
      paths.preflightReadinessPath,
      consultationPreflightReadinessArtifactSchema,
    ),
    clarifyFollowUp: store.readOptionalParsedArtifactSync(
      paths.clarifyFollowUpPath,
      consultationClarifyFollowUpSchema,
    ),
    researchBrief: store.readOptionalParsedArtifactSync(
      paths.researchBriefPath,
      consultationResearchBriefSchema,
    ),
    failureAnalysis: store.readOptionalParsedArtifactSync(
      paths.failureAnalysisPath,
      failureAnalysisSchema,
    ),
    profileSelection: store.readOptionalParsedArtifactSync(
      paths.profileSelectionPath,
      consultationProfileSelectionArtifactSchema,
    ),
    comparisonReport: store.readOptionalParsedArtifactSync(
      paths.comparisonJsonPath,
      comparisonReportSchema,
    ),
    comparisonMarkdownAvailable: paths.comparisonMarkdownPath
      ? hasCurrentComparisonMarkdownArtifactSync(paths.comparisonMarkdownPath, expectedRunId)
      : false,
    winnerSelection: store.readOptionalParsedArtifactSync(
      paths.winnerSelectionPath,
      agentJudgeResultSchema,
    ),
    secondOpinionWinnerSelection: store.readOptionalParsedArtifactSync(
      paths.secondOpinionWinnerSelectionPath,
      secondOpinionWinnerSelectionArtifactSchema,
    ),
    crowningRecord: store.readOptionalParsedArtifactSync(
      paths.crowningRecordPath,
      exportPlanSchema,
    ),
  };
}
