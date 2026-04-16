import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";

import type { ZodTypeAny, z } from "zod";

import { agentRunResultSchema } from "../adapters/types.js";
import { OraculumError } from "../core/errors.js";
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
  getCandidatesDir,
  getCandidateTaskPacketPath,
  getCandidateVerdictPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
  getCandidateWitnessPath,
  getClarifyFollowUpPath,
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
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
  resolveProjectRoot,
} from "../core/paths.js";
import type { OracleVerdict, Witness } from "../domain/oracle.js";
import { toCanonicalConsultationProfileSelection } from "../domain/profile.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  candidateManifestSchema,
  candidateScorecardSchema,
  latestRunStateSchema,
  type RunManifest,
  runManifestSchema,
} from "../domain/run.js";
import type { MaterializedTaskPacket } from "../domain/task.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { pathExists, writeJsonFile } from "./project.js";
import { parseRunManifestArtifact } from "./run-manifest-artifact.js";

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

export class RunStore {
  readonly projectRoot: string;

  constructor(cwd: string) {
    this.projectRoot = resolveProjectRoot(cwd);
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

  async ensureRunDirectories(runId: string): Promise<RunArtifactPaths> {
    const paths = this.getRunPaths(runId);
    await Promise.all([
      mkdir(paths.runDir, { recursive: true }),
      mkdir(paths.reportsDir, { recursive: true }),
    ]);
    return paths;
  }

  async ensureCandidateDirectories(
    runId: string,
    candidateId: string,
  ): Promise<CandidateArtifactPaths> {
    const paths = this.getCandidatePaths(runId, candidateId);
    await Promise.all([
      mkdir(paths.candidateDir, { recursive: true }),
      mkdir(paths.workspaceDir, { recursive: true }),
      mkdir(paths.verdictsDir, { recursive: true }),
      mkdir(paths.witnessesDir, { recursive: true }),
      mkdir(paths.logsDir, { recursive: true }),
    ]);
    return paths;
  }

  async readRunManifest(runId: string): Promise<RunManifest> {
    const manifestPath = this.getRunPaths(runId).manifestPath;
    if (!(await pathExists(manifestPath))) {
      throw new OraculumError(`Consultation record not found: ${manifestPath}`);
    }

    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return parseRunManifestArtifact(raw);
  }

  async writeRunManifest(manifest: RunManifest): Promise<void> {
    const parsedManifest = runManifestSchema.parse(manifest);
    await this.writeJsonArtifact(this.getRunPaths(manifest.id).manifestPath, {
      ...parsedManifest,
      ...(parsedManifest.profileSelection
        ? {
            profileSelection: toCanonicalConsultationProfileSelection(
              parsedManifest.profileSelection,
            ),
          }
        : {}),
    });
  }

  async writeCandidateManifest(runId: string, candidate: CandidateManifest): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidatePaths(runId, candidate.id).manifestPath,
      candidateManifestSchema.parse(candidate),
    );
  }

  async readCandidateTaskPacket(
    runId: string,
    candidateId: string,
  ): Promise<MaterializedTaskPacket> {
    const taskPacketPath = this.getCandidatePaths(runId, candidateId).taskPacketPath;
    return materializedTaskPacketSchema.parse(
      JSON.parse(await readFile(taskPacketPath, "utf8")) as unknown,
    );
  }

  async writeCandidateTaskPacket(
    runId: string,
    candidateId: string,
    taskPacket: MaterializedTaskPacket,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidatePaths(runId, candidateId).taskPacketPath,
      materializedTaskPacketSchema.parse(taskPacket),
    );
  }

  async readCandidateScorecard(
    runId: string,
    candidateId: string,
  ): Promise<CandidateScorecard | undefined> {
    const scorecardPath = this.getCandidatePaths(runId, candidateId).scorecardPath;
    if (!(await pathExists(scorecardPath))) {
      return undefined;
    }

    return candidateScorecardSchema.parse(
      JSON.parse(await readFile(scorecardPath, "utf8")) as unknown,
    );
  }

  async writeCandidateScorecard(
    runId: string,
    candidateId: string,
    scorecard: CandidateScorecard,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidatePaths(runId, candidateId).scorecardPath,
      candidateScorecardSchema.parse(scorecard),
    );
  }

  async writeCandidateAgentResult(
    runId: string,
    candidateId: string,
    result: z.infer<typeof agentRunResultSchema>,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidatePaths(runId, candidateId).agentResultPath,
      agentRunResultSchema.parse(result),
    );
  }

  async writeCandidateRepairAttemptResult(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
    result: z.infer<typeof agentRunResultSchema>,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidateRepairAttemptResultPath(runId, candidateId, roundId, attempt),
      agentRunResultSchema.parse(result),
    );
  }

  async writeCandidateVerdict(
    runId: string,
    candidateId: string,
    roundId: string,
    verdict: OracleVerdict,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidateVerdictPath(runId, candidateId, roundId, verdict.oracleId),
      verdict,
    );
  }

  async writeCandidateWitness(
    runId: string,
    candidateId: string,
    roundId: string,
    witness: Witness,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.getCandidateWitnessPath(runId, candidateId, roundId, witness.id),
      witness,
    );
  }

  async writeLatestRunState(runId: string): Promise<void> {
    await this.writeJsonArtifact(
      this.latestRunStatePath,
      latestRunStateSchema.parse({
        runId,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async writeLatestExportableRunState(runId: string): Promise<void> {
    await this.writeJsonArtifact(
      this.latestExportableRunStatePath,
      latestRunStateSchema.parse({
        runId,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  async readLatestRunId(): Promise<string> {
    if (!(await pathExists(this.latestRunStatePath))) {
      throw new OraculumError(
        "No previous consultation found. Start with `orc consult ...` after setup.",
      );
    }

    const parsed = latestRunStateSchema.parse(
      JSON.parse(await readFile(this.latestRunStatePath, "utf8")) as unknown,
    );
    return parsed.runId;
  }

  async readLatestExportableRunId(): Promise<string> {
    if (!(await pathExists(this.latestExportableRunStatePath))) {
      throw new OraculumError(
        "No crownable consultation found yet. Complete a consultation with a recommended result first.",
      );
    }

    const parsed = latestRunStateSchema.parse(
      JSON.parse(await readFile(this.latestExportableRunStatePath, "utf8")) as unknown,
    );
    return parsed.runId;
  }

  async readOptionalParsedArtifact<TSchema extends ZodTypeAny>(
    path: string | undefined,
    schema: TSchema,
  ): Promise<z.infer<TSchema> | undefined> {
    if (!path || !(await pathExists(path))) {
      return undefined;
    }

    try {
      return schema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch {
      return undefined;
    }
  }

  readOptionalParsedArtifactSync<TSchema extends ZodTypeAny>(
    path: string | undefined,
    schema: TSchema,
  ): z.infer<TSchema> | undefined {
    if (!path || !existsSync(path)) {
      return undefined;
    }

    try {
      return schema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    } catch {
      return undefined;
    }
  }

  async writeJsonArtifact(path: string, value: unknown): Promise<void> {
    await writeJsonFile(path, value);
  }
}
