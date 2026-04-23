export interface RunArtifactPaths {
  runDir: string;
  manifestPath: string;
  candidatesDir: string;
  reportsDir: string;
  configPath: string;
  consultationPlanPath: string;
  consultationPlanMarkdownPath: string;
  consultationPlanReadinessPath: string;
  consultationPlanReviewPath: string;
  planningDepthPath: string;
  planningInterviewPath: string;
  planningSpecPath: string;
  planningSpecMarkdownPath: string;
  planConsensusPath: string;
  specSelectionPath: string;
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
  specPath: string;
  baseSnapshotPath: string;
  verdictsDir: string;
  witnessesDir: string;
  logsDir: string;
  scorecardPath: string;
  workspaceDir: string;
}
