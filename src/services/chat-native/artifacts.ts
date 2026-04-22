import {
  resolveConsultationArtifactsSync,
  toAvailableConsultationArtifactPaths,
} from "../consultation-artifacts.js";
import type { InitializeProjectResult } from "../project.js";

export function buildConsultationArtifacts(
  cwd: string,
  consultationId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
): {
  consultationRoot: string;
  configPath?: string;
  consultationPlanPath?: string;
  consultationPlanMarkdownPath?: string;
  consultationPlanReadinessPath?: string;
  consultationPlanReviewPath?: string;
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
} {
  return toAvailableConsultationArtifactPaths(
    resolveConsultationArtifactsSync(cwd, consultationId, options),
  );
}

export function buildProjectInitializationResult(result: InitializeProjectResult): {
  projectRoot: string;
  configPath: string;
  createdPaths: string[];
} {
  return {
    projectRoot: result.projectRoot,
    configPath: result.configPath,
    createdPaths: result.createdPaths,
  };
}
