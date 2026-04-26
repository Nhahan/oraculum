import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { hasNonEmptyTextArtifact, hasNonEmptyTextArtifactSync } from "../project.js";

import { extractComparisonMarkdownRunId, hasArtifactRunId } from "./shared.js";
import type {
  ConsultationArtifactPaths,
  ConsultationArtifactState,
  LoadedConsultationArtifacts,
} from "./types.js";

export function buildConsultationArtifactState(
  paths: ConsultationArtifactPaths,
  loaded: LoadedConsultationArtifacts,
  options?: {
    hasExportedCandidate?: boolean;
    expectedRunId?: string;
  },
): ConsultationArtifactState {
  const expectedRunId = options?.expectedRunId;
  const consultationPlan = filterArtifactForConsultationRun(loaded.consultationPlan, {
    expectedRunId,
  });
  const consultationPlanReadiness = filterArtifactForConsultationRun(
    loaded.consultationPlanReadiness,
    {
      expectedRunId,
    },
  );
  const consultationPlanReview = filterArtifactForConsultationRun(loaded.consultationPlanReview, {
    expectedRunId,
  });
  const planningDepth = filterArtifactForConsultationRun(loaded.planningDepth, { expectedRunId });
  const planningInterview = filterArtifactForConsultationRun(loaded.planningInterview, {
    expectedRunId,
  });
  const planningSpec = filterArtifactForConsultationRun(loaded.planningSpec, { expectedRunId });
  const planConsensus = filterArtifactForConsultationRun(loaded.planConsensus, { expectedRunId });
  const preflightReadiness = filterArtifactForConsultationRun(loaded.preflightReadiness, {
    expectedRunId,
  });
  const clarifyFollowUp = filterArtifactForConsultationRun(loaded.clarifyFollowUp, {
    expectedRunId,
  });
  const researchBrief = filterArtifactForConsultationRun(loaded.researchBrief, {
    expectedRunId,
  });
  const failureAnalysis = filterArtifactForConsultationRun(loaded.failureAnalysis, {
    expectedRunId,
  });
  const profileSelection = filterArtifactForConsultationRun(loaded.profileSelection, {
    expectedRunId,
  });
  const comparisonReport = filterArtifactForConsultationRun(loaded.comparisonReport, {
    expectedRunId,
  });
  const winnerSelection = filterArtifactForConsultationRun(loaded.winnerSelection, {
    expectedRunId,
  });
  const secondOpinionWinnerSelection = filterArtifactForConsultationRun(
    loaded.secondOpinionWinnerSelection,
    { expectedRunId },
  );
  const hasExportedCandidate = options?.hasExportedCandidate ?? false;
  const crowningRecord = hasExportedCandidate
    ? filterArtifactForConsultationRun(loaded.crowningRecord, { expectedRunId })
    : undefined;
  const manualReviewRequired = Boolean(
    secondOpinionWinnerSelection && secondOpinionWinnerSelection.agreement !== "agrees-select",
  );

  return {
    consultationRoot: paths.consultationRoot,
    ...(paths.planningSourceRunId ? { planningSourceRunId: paths.planningSourceRunId } : {}),
    ...(paths.planningSourceConsultationPlanPath
      ? { planningSourceConsultationPlanPath: paths.planningSourceConsultationPlanPath }
      : {}),
    ...(paths.configPath && existsSync(paths.configPath) ? { configPath: paths.configPath } : {}),
    ...(consultationPlan && paths.consultationPlanPath
      ? { consultationPlanPath: paths.consultationPlanPath, consultationPlan }
      : {}),
    ...(loaded.consultationPlanMarkdownAvailable && paths.consultationPlanMarkdownPath
      ? { consultationPlanMarkdownPath: paths.consultationPlanMarkdownPath }
      : {}),
    ...(consultationPlanReadiness && paths.consultationPlanReadinessPath
      ? {
          consultationPlanReadinessPath: paths.consultationPlanReadinessPath,
          consultationPlanReadiness,
        }
      : {}),
    ...(consultationPlanReview && paths.consultationPlanReviewPath
      ? { consultationPlanReviewPath: paths.consultationPlanReviewPath, consultationPlanReview }
      : {}),
    ...(planningDepth && paths.planningDepthPath
      ? { planningDepthPath: paths.planningDepthPath, planningDepth }
      : {}),
    ...(planningInterview && paths.planningInterviewPath
      ? { planningInterviewPath: paths.planningInterviewPath, planningInterview }
      : {}),
    ...(planningSpec && paths.planningSpecPath
      ? { planningSpecPath: paths.planningSpecPath, planningSpec }
      : {}),
    ...(loaded.planningSpecMarkdownAvailable && paths.planningSpecMarkdownPath
      ? { planningSpecMarkdownPath: paths.planningSpecMarkdownPath }
      : {}),
    ...(planConsensus && paths.planConsensusPath
      ? { planConsensusPath: paths.planConsensusPath, planConsensus }
      : {}),
    ...(preflightReadiness && paths.preflightReadinessPath
      ? { preflightReadinessPath: paths.preflightReadinessPath, preflightReadiness }
      : {}),
    ...(clarifyFollowUp && paths.clarifyFollowUpPath
      ? { clarifyFollowUpPath: paths.clarifyFollowUpPath, clarifyFollowUp }
      : {}),
    ...(researchBrief && paths.researchBriefPath
      ? { researchBriefPath: paths.researchBriefPath, researchBrief }
      : {}),
    ...(failureAnalysis && paths.failureAnalysisPath
      ? { failureAnalysisPath: paths.failureAnalysisPath, failureAnalysis }
      : {}),
    ...(profileSelection && paths.profileSelectionPath
      ? { profileSelectionPath: paths.profileSelectionPath, profileSelection }
      : {}),
    ...(comparisonReport && paths.comparisonJsonPath
      ? { comparisonJsonPath: paths.comparisonJsonPath, comparisonReport }
      : {}),
    ...(loaded.comparisonMarkdownAvailable && paths.comparisonMarkdownPath
      ? { comparisonMarkdownPath: paths.comparisonMarkdownPath }
      : {}),
    ...(winnerSelection && paths.winnerSelectionPath
      ? { winnerSelectionPath: paths.winnerSelectionPath, winnerSelection }
      : {}),
    ...(secondOpinionWinnerSelection && paths.secondOpinionWinnerSelectionPath
      ? {
          secondOpinionWinnerSelectionPath: paths.secondOpinionWinnerSelectionPath,
          secondOpinionWinnerSelection,
        }
      : {}),
    ...(crowningRecord && paths.crowningRecordPath
      ? { crowningRecordPath: paths.crowningRecordPath, crowningRecord }
      : {}),
    comparisonReportAvailable: Boolean(comparisonReport || loaded.comparisonMarkdownAvailable),
    manualReviewRequired,
    crowningRecordAvailable: Boolean(crowningRecord),
    hasExportedCandidate,
    artifactDiagnostics: loaded.artifactDiagnostics,
  };
}

export function toAvailableConsultationArtifactPaths(
  state: ConsultationArtifactState,
): ConsultationArtifactPaths {
  return {
    consultationRoot: state.consultationRoot,
    ...(state.planningSourceRunId ? { planningSourceRunId: state.planningSourceRunId } : {}),
    ...(state.planningSourceConsultationPlanPath
      ? { planningSourceConsultationPlanPath: state.planningSourceConsultationPlanPath }
      : {}),
    ...(state.configPath ? { configPath: state.configPath } : {}),
    ...(state.consultationPlanPath ? { consultationPlanPath: state.consultationPlanPath } : {}),
    ...(state.consultationPlanMarkdownPath
      ? { consultationPlanMarkdownPath: state.consultationPlanMarkdownPath }
      : {}),
    ...(state.consultationPlanReadinessPath
      ? { consultationPlanReadinessPath: state.consultationPlanReadinessPath }
      : {}),
    ...(state.consultationPlanReviewPath
      ? { consultationPlanReviewPath: state.consultationPlanReviewPath }
      : {}),
    ...(state.planningDepthPath ? { planningDepthPath: state.planningDepthPath } : {}),
    ...(state.planningInterviewPath ? { planningInterviewPath: state.planningInterviewPath } : {}),
    ...(state.planningSpecPath ? { planningSpecPath: state.planningSpecPath } : {}),
    ...(state.planningSpecMarkdownPath
      ? { planningSpecMarkdownPath: state.planningSpecMarkdownPath }
      : {}),
    ...(state.planConsensusPath ? { planConsensusPath: state.planConsensusPath } : {}),
    ...(state.preflightReadinessPath
      ? { preflightReadinessPath: state.preflightReadinessPath }
      : {}),
    ...(state.clarifyFollowUpPath ? { clarifyFollowUpPath: state.clarifyFollowUpPath } : {}),
    ...(state.researchBriefPath ? { researchBriefPath: state.researchBriefPath } : {}),
    ...(state.failureAnalysisPath ? { failureAnalysisPath: state.failureAnalysisPath } : {}),
    ...(state.profileSelectionPath ? { profileSelectionPath: state.profileSelectionPath } : {}),
    ...(state.comparisonJsonPath ? { comparisonJsonPath: state.comparisonJsonPath } : {}),
    ...(state.comparisonMarkdownPath
      ? { comparisonMarkdownPath: state.comparisonMarkdownPath }
      : {}),
    ...(state.winnerSelectionPath ? { winnerSelectionPath: state.winnerSelectionPath } : {}),
    ...(state.secondOpinionWinnerSelectionPath
      ? { secondOpinionWinnerSelectionPath: state.secondOpinionWinnerSelectionPath }
      : {}),
    ...(state.crowningRecordPath ? { crowningRecordPath: state.crowningRecordPath } : {}),
  };
}

export function filterArtifactForConsultationRun<T>(
  artifact: T | undefined,
  options: {
    expectedRunId: string | undefined;
    allowMissingRunId?: boolean;
  },
): T | undefined {
  const expectedRunId = options.expectedRunId;
  if (!artifact || !expectedRunId) {
    return artifact;
  }

  if (!hasArtifactRunId(artifact)) {
    return options.allowMissingRunId ? artifact : undefined;
  }

  return artifact.runId === expectedRunId ? artifact : undefined;
}

export async function hasCurrentComparisonMarkdownArtifact(
  path: string,
  expectedRunId: string | undefined,
): Promise<boolean> {
  if (!(await hasNonEmptyTextArtifact(path))) {
    return false;
  }

  if (!expectedRunId) {
    return true;
  }

  try {
    return extractComparisonMarkdownRunId(await readFile(path, "utf8")) === expectedRunId;
  } catch {
    return false;
  }
}

export function hasCurrentComparisonMarkdownArtifactSync(
  path: string,
  expectedRunId: string | undefined,
): boolean {
  if (!hasNonEmptyTextArtifactSync(path)) {
    return false;
  }

  if (!expectedRunId) {
    return true;
  }

  try {
    return extractComparisonMarkdownRunId(readFileSync(path, "utf8")) === expectedRunId;
  } catch {
    return false;
  }
}
