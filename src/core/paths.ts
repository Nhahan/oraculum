import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ORACULUM_DIRNAME = ".oraculum";
export const TASKS_DIRNAME = "tasks";

export function resolveProjectRoot(cwd: string): string {
  const start = resolve(cwd);
  return findInitializedProjectRoot(start) ?? start;
}

function findInitializedProjectRoot(start: string): string | undefined {
  let current = start;
  while (true) {
    if (existsSync(getConfigPath(current))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function getOraculumDir(projectRoot: string): string {
  return join(projectRoot, ORACULUM_DIRNAME);
}

export function getConfigPath(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "config.json");
}

export function getAdvancedConfigPath(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "advanced.json");
}

export function getGeneratedTasksDir(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "tasks");
}

export function getLatestRunStatePath(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "latest-run.json");
}

export function getLatestExportableRunStatePath(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "latest-exportable-run.json");
}

export function getTasksDir(projectRoot: string): string {
  return join(projectRoot, TASKS_DIRNAME);
}

export function getRunsDir(projectRoot: string): string {
  return join(getOraculumDir(projectRoot), "runs");
}

export function getRunDir(projectRoot: string, runId: string): string {
  return join(getRunsDir(projectRoot), runId);
}

export function getRunManifestPath(projectRoot: string, runId: string): string {
  return join(getRunDir(projectRoot, runId), "run.json");
}

export function getCandidatesDir(projectRoot: string, runId: string): string {
  return join(getRunDir(projectRoot, runId), "candidates");
}

export function getCandidateDir(projectRoot: string, runId: string, candidateId: string): string {
  return join(getCandidatesDir(projectRoot, runId), candidateId);
}

export function getCandidateManifestPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "candidate.json");
}

export function getCandidateAgentResultPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "agent-run.json");
}

export function getCandidateTaskPacketPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "task-packet.json");
}

export function getCandidateBaseSnapshotPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "base-snapshot.json");
}

export function getCandidateVerdictsDir(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "verdicts");
}

export function getCandidateVerdictPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  oracleId: string,
): string {
  return join(
    getCandidateVerdictsDir(projectRoot, runId, candidateId),
    `${roundId}--${oracleId}.json`,
  );
}

export function getCandidateWitnessesDir(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "witnesses");
}

export function getCandidateWitnessPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  witnessId: string,
): string {
  return join(
    getCandidateWitnessesDir(projectRoot, runId, candidateId),
    `${roundId}--${witnessId}.json`,
  );
}

export function getCandidateLogsDir(
  projectRoot: string,
  runId: string,
  candidateId: string,
): string {
  return join(getCandidateDir(projectRoot, runId, candidateId), "logs");
}

export function getCandidateRepairAttemptLogsDir(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  attempt: number,
): string {
  return join(
    getCandidateLogsDir(projectRoot, runId, candidateId),
    "repairs",
    `${roundId}-attempt-${attempt}`,
  );
}

export function getCandidateRepairAttemptResultPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  attempt: number,
): string {
  return join(
    getCandidateDir(projectRoot, runId, candidateId),
    `agent-run.${roundId}.repair-${attempt}.json`,
  );
}

export function getCandidateOracleStdoutLogPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  oracleId: string,
): string {
  return join(
    getCandidateLogsDir(projectRoot, runId, candidateId),
    `${roundId}--${oracleId}.stdout.log`,
  );
}

export function getCandidateOracleStderrLogPath(
  projectRoot: string,
  runId: string,
  candidateId: string,
  roundId: string,
  oracleId: string,
): string {
  return join(
    getCandidateLogsDir(projectRoot, runId, candidateId),
    `${roundId}--${oracleId}.stderr.log`,
  );
}

export function getReportsDir(projectRoot: string, runId: string): string {
  return join(getRunDir(projectRoot, runId), "reports");
}

export function getExportPlanPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "export-plan.json");
}

export function getExportPatchPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "export.patch");
}

export function getExportSyncSummaryPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "export-sync.json");
}

export function getFinalistComparisonJsonPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "comparison.json");
}

export function getFinalistComparisonMarkdownPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "comparison.md");
}

export function getWinnerSelectionPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "winner-selection.json");
}

export function getProfileSelectionPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "profile-selection.json");
}

export function getPreflightReadinessPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "preflight-readiness.json");
}

export function getResearchBriefPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "research-brief.json");
}

export function getRunConfigPath(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "consultation-config.json");
}

export function getWinnerJudgeLogsDir(projectRoot: string, runId: string): string {
  return join(getReportsDir(projectRoot, runId), "judge");
}

export function getWorkspaceDir(projectRoot: string, runId: string, candidateId: string): string {
  return join(getOraculumDir(projectRoot), "workspaces", runId, candidateId);
}
