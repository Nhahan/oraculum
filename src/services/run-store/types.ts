export interface RunArtifactPaths {
  runDir: string;
  manifestPath: string;
  candidatesDir: string;
  reportsDir: string;
  configPath: string;
  consultationPlanPath: string;
  consultationPlanMarkdownPath: string;
  exportPlanPath: string;
  exportPatchPath: string;
  exportSyncSummaryPath: string;
  comparisonJsonPath: string;
  comparisonMarkdownPath: string;
  winnerSelectionPath: string;
  secondOpinionWinnerSelectionPath: string;
  finalistScorecardsPath: string;
  profileSelectionPath: string;
  preflightReadinessPath: string;
  clarifyFollowUpPath: string;
  researchBriefPath: string;
  failureAnalysisPath: string;
  winnerJudgeLogsDir: string;
  secondOpinionWinnerJudgeLogsDir: string;
}

export interface CandidateArtifactPaths {
  candidateDir: string;
  manifestPath: string;
  agentResultPath: string;
  taskPacketPath: string;
  baseSnapshotPath: string;
  verdictsDir: string;
  witnessesDir: string;
  logsDir: string;
  scorecardPath: string;
  workspaceDir: string;
}
