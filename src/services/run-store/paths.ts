import {
  getCandidateAgentResultPath,
  getCandidateBaseSnapshotPath,
  getCandidateDir,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateRepairAttemptLogsDir,
  getCandidateRepairAttemptResultPath,
  getCandidateScorecardPath,
  getCandidateSpecPath,
  getCandidateSpecSelectionPath,
  getCandidatesDir,
  getCandidateTaskPacketPath,
  getCandidateVerdictPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
  getCandidateWitnessPath,
  getClarifyFollowUpPath,
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
  getConsultationPlanReadinessPath,
  getConsultationPlanReviewPath,
  getExportPatchPath,
  getExportPlanPath,
  getExportSyncSummaryPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getFinalistScorecardsPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getOraculumDir,
  getPlanConsensusPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getPlanningSpecMarkdownPath,
  getPlanningSpecPath,
  getPreflightReadinessPath,
  getPressureEvidencePath,
  getProfileSelectionPath,
  getReportsDir,
  getResearchBriefPath,
  getRunConfigPath,
  getRunDir,
  getRunManifestPath,
  getRunsDir,
  getSecondOpinionWinnerJudgeLogsDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerJudgeLogsDir,
  getWinnerSelectionPath,
  getWorkspaceDir,
} from "../../core/paths.js";
import type { CandidateArtifactPaths, RunArtifactPaths } from "./types.js";

export class RunPathStore {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  get oraculumDir(): string {
    return getOraculumDir(this.projectRoot);
  }

  get runsDir(): string {
    return getRunsDir(this.projectRoot);
  }

  get latestRunStatePath(): string {
    return getLatestRunStatePath(this.projectRoot);
  }

  get latestExportableRunStatePath(): string {
    return getLatestExportableRunStatePath(this.projectRoot);
  }

  get pressureEvidencePath(): string {
    return getPressureEvidencePath(this.projectRoot);
  }

  getRunPaths(runId: string): RunArtifactPaths {
    return {
      runDir: getRunDir(this.projectRoot, runId),
      manifestPath: getRunManifestPath(this.projectRoot, runId),
      candidatesDir: getCandidatesDir(this.projectRoot, runId),
      reportsDir: getReportsDir(this.projectRoot, runId),
      configPath: getRunConfigPath(this.projectRoot, runId),
      consultationPlanPath: getConsultationPlanPath(this.projectRoot, runId),
      consultationPlanMarkdownPath: getConsultationPlanMarkdownPath(this.projectRoot, runId),
      consultationPlanReadinessPath: getConsultationPlanReadinessPath(this.projectRoot, runId),
      consultationPlanReviewPath: getConsultationPlanReviewPath(this.projectRoot, runId),
      planningDepthPath: getPlanningDepthPath(this.projectRoot, runId),
      planningInterviewPath: getPlanningInterviewPath(this.projectRoot, runId),
      planningSpecPath: getPlanningSpecPath(this.projectRoot, runId),
      planningSpecMarkdownPath: getPlanningSpecMarkdownPath(this.projectRoot, runId),
      planConsensusPath: getPlanConsensusPath(this.projectRoot, runId),
      specSelectionPath: getCandidateSpecSelectionPath(this.projectRoot, runId),
      exportPlanPath: getExportPlanPath(this.projectRoot, runId),
      exportPatchPath: getExportPatchPath(this.projectRoot, runId),
      exportSyncSummaryPath: getExportSyncSummaryPath(this.projectRoot, runId),
      comparisonJsonPath: getFinalistComparisonJsonPath(this.projectRoot, runId),
      comparisonMarkdownPath: getFinalistComparisonMarkdownPath(this.projectRoot, runId),
      winnerSelectionPath: getWinnerSelectionPath(this.projectRoot, runId),
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
        this.projectRoot,
        runId,
      ),
      finalistScorecardsPath: getFinalistScorecardsPath(this.projectRoot, runId),
      profileSelectionPath: getProfileSelectionPath(this.projectRoot, runId),
      preflightReadinessPath: getPreflightReadinessPath(this.projectRoot, runId),
      clarifyFollowUpPath: getClarifyFollowUpPath(this.projectRoot, runId),
      researchBriefPath: getResearchBriefPath(this.projectRoot, runId),
      failureAnalysisPath: getFailureAnalysisPath(this.projectRoot, runId),
      winnerJudgeLogsDir: getWinnerJudgeLogsDir(this.projectRoot, runId),
      secondOpinionWinnerJudgeLogsDir: getSecondOpinionWinnerJudgeLogsDir(this.projectRoot, runId),
    };
  }

  getCandidatePaths(runId: string, candidateId: string): CandidateArtifactPaths {
    return {
      candidateDir: getCandidateDir(this.projectRoot, runId, candidateId),
      manifestPath: getCandidateManifestPath(this.projectRoot, runId, candidateId),
      agentResultPath: getCandidateAgentResultPath(this.projectRoot, runId, candidateId),
      taskPacketPath: getCandidateTaskPacketPath(this.projectRoot, runId, candidateId),
      specPath: getCandidateSpecPath(this.projectRoot, runId, candidateId),
      baseSnapshotPath: getCandidateBaseSnapshotPath(this.projectRoot, runId, candidateId),
      verdictsDir: getCandidateVerdictsDir(this.projectRoot, runId, candidateId),
      witnessesDir: getCandidateWitnessesDir(this.projectRoot, runId, candidateId),
      logsDir: getCandidateLogsDir(this.projectRoot, runId, candidateId),
      scorecardPath: getCandidateScorecardPath(this.projectRoot, runId, candidateId),
      workspaceDir: getWorkspaceDir(this.projectRoot, runId, candidateId),
    };
  }

  getCandidateRepairAttemptLogsDir(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
  ): string {
    return getCandidateRepairAttemptLogsDir(this.projectRoot, runId, candidateId, roundId, attempt);
  }

  getCandidateRepairAttemptResultPath(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
  ): string {
    return getCandidateRepairAttemptResultPath(
      this.projectRoot,
      runId,
      candidateId,
      roundId,
      attempt,
    );
  }

  getCandidateOracleStdoutLogPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return getCandidateOracleStdoutLogPath(this.projectRoot, runId, candidateId, roundId, oracleId);
  }

  getCandidateOracleStderrLogPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return getCandidateOracleStderrLogPath(this.projectRoot, runId, candidateId, roundId, oracleId);
  }

  getCandidateVerdictPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return getCandidateVerdictPath(this.projectRoot, runId, candidateId, roundId, oracleId);
  }

  getCandidateWitnessPath(
    runId: string,
    candidateId: string,
    roundId: string,
    witnessId: string,
  ): string {
    return getCandidateWitnessPath(this.projectRoot, runId, candidateId, roundId, witnessId);
  }
}
