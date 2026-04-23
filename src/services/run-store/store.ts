import type { ZodTypeAny, z } from "zod";

import type { agentRunResultSchema } from "../../adapters/types.js";
import { resolveProjectRoot } from "../../core/paths.js";
import type { OracleVerdict, Witness } from "../../domain/oracle.js";
import type { CandidateManifest, CandidateScorecard, RunManifest } from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

import { RunArtifactStore } from "./artifacts.js";
import { LatestRunStateStore } from "./latest-state.js";
import { RunPathStore } from "./paths.js";
import type { CandidateArtifactPaths, RunArtifactPaths } from "./types.js";

export type { CandidateArtifactPaths, RunArtifactPaths } from "./types.js";

export class RunStore {
  readonly projectRoot: string;

  private readonly pathStore: RunPathStore;
  private readonly artifactStore: RunArtifactStore;
  private readonly latestStateStore: LatestRunStateStore;

  constructor(cwd: string) {
    this.projectRoot = resolveProjectRoot(cwd);
    this.pathStore = new RunPathStore(this.projectRoot);
    this.artifactStore = new RunArtifactStore(this.pathStore);
    this.latestStateStore = new LatestRunStateStore(this.pathStore);
  }

  get oraculumDir(): string {
    return this.pathStore.oraculumDir;
  }

  get runsDir(): string {
    return this.pathStore.runsDir;
  }

  get latestRunStatePath(): string {
    return this.pathStore.latestRunStatePath;
  }

  get latestExportableRunStatePath(): string {
    return this.pathStore.latestExportableRunStatePath;
  }

  get pressureEvidencePath(): string {
    return this.pathStore.pressureEvidencePath;
  }

  getRunPaths(runId: string): RunArtifactPaths {
    return this.pathStore.getRunPaths(runId);
  }

  getCandidatePaths(runId: string, candidateId: string): CandidateArtifactPaths {
    return this.pathStore.getCandidatePaths(runId, candidateId);
  }

  getCandidateRepairAttemptLogsDir(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
  ): string {
    return this.pathStore.getCandidateRepairAttemptLogsDir(runId, candidateId, roundId, attempt);
  }

  getCandidateRepairAttemptResultPath(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
  ): string {
    return this.pathStore.getCandidateRepairAttemptResultPath(runId, candidateId, roundId, attempt);
  }

  getCandidateOracleStdoutLogPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return this.pathStore.getCandidateOracleStdoutLogPath(runId, candidateId, roundId, oracleId);
  }

  getCandidateOracleStderrLogPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return this.pathStore.getCandidateOracleStderrLogPath(runId, candidateId, roundId, oracleId);
  }

  getCandidateVerdictPath(
    runId: string,
    candidateId: string,
    roundId: string,
    oracleId: string,
  ): string {
    return this.pathStore.getCandidateVerdictPath(runId, candidateId, roundId, oracleId);
  }

  getCandidateWitnessPath(
    runId: string,
    candidateId: string,
    roundId: string,
    witnessId: string,
  ): string {
    return this.pathStore.getCandidateWitnessPath(runId, candidateId, roundId, witnessId);
  }

  async ensureRunDirectories(runId: string): Promise<RunArtifactPaths> {
    return this.artifactStore.ensureRunDirectories(runId);
  }

  async ensureCandidateDirectories(
    runId: string,
    candidateId: string,
  ): Promise<CandidateArtifactPaths> {
    return this.artifactStore.ensureCandidateDirectories(runId, candidateId);
  }

  async readRunManifest(runId: string): Promise<RunManifest> {
    return this.artifactStore.readRunManifest(runId);
  }

  async writeRunManifest(manifest: RunManifest): Promise<void> {
    return this.artifactStore.writeRunManifest(manifest);
  }

  async writeCandidateManifest(runId: string, candidate: CandidateManifest): Promise<void> {
    return this.artifactStore.writeCandidateManifest(runId, candidate);
  }

  async readCandidateTaskPacket(
    runId: string,
    candidateId: string,
  ): Promise<MaterializedTaskPacket> {
    return this.artifactStore.readCandidateTaskPacket(runId, candidateId);
  }

  async writeCandidateTaskPacket(
    runId: string,
    candidateId: string,
    taskPacket: MaterializedTaskPacket,
  ): Promise<void> {
    return this.artifactStore.writeCandidateTaskPacket(runId, candidateId, taskPacket);
  }

  async readCandidateScorecard(
    runId: string,
    candidateId: string,
  ): Promise<CandidateScorecard | undefined> {
    return this.artifactStore.readCandidateScorecard(runId, candidateId);
  }

  async writeCandidateScorecard(
    runId: string,
    candidateId: string,
    scorecard: CandidateScorecard,
  ): Promise<void> {
    return this.artifactStore.writeCandidateScorecard(runId, candidateId, scorecard);
  }

  async writeCandidateAgentResult(
    runId: string,
    candidateId: string,
    result: z.infer<typeof agentRunResultSchema>,
  ): Promise<void> {
    return this.artifactStore.writeCandidateAgentResult(runId, candidateId, result);
  }

  async writeCandidateRepairAttemptResult(
    runId: string,
    candidateId: string,
    roundId: string,
    attempt: number,
    result: z.infer<typeof agentRunResultSchema>,
  ): Promise<void> {
    return this.artifactStore.writeCandidateRepairAttemptResult(
      runId,
      candidateId,
      roundId,
      attempt,
      result,
    );
  }

  async writeCandidateVerdict(
    runId: string,
    candidateId: string,
    roundId: string,
    verdict: OracleVerdict,
  ): Promise<void> {
    return this.artifactStore.writeCandidateVerdict(runId, candidateId, roundId, verdict);
  }

  async writeCandidateWitness(
    runId: string,
    candidateId: string,
    roundId: string,
    witness: Witness,
  ): Promise<void> {
    return this.artifactStore.writeCandidateWitness(runId, candidateId, roundId, witness);
  }

  async writeLatestRunState(runId: string): Promise<void> {
    return this.latestStateStore.writeLatestRunState(runId);
  }

  async writeLatestExportableRunState(runId: string): Promise<void> {
    return this.latestStateStore.writeLatestExportableRunState(runId);
  }

  async readLatestRunId(): Promise<string> {
    return this.latestStateStore.readLatestRunId();
  }

  async readLatestExportableRunId(): Promise<string> {
    return this.latestStateStore.readLatestExportableRunId();
  }

  async readOptionalParsedArtifact<TSchema extends ZodTypeAny>(
    path: string | undefined,
    schema: TSchema,
  ): Promise<z.infer<TSchema> | undefined> {
    return this.artifactStore.readOptionalParsedArtifact(path, schema);
  }

  readOptionalParsedArtifactSync<TSchema extends ZodTypeAny>(
    path: string | undefined,
    schema: TSchema,
  ): z.infer<TSchema> | undefined {
    return this.artifactStore.readOptionalParsedArtifactSync(path, schema);
  }

  async writeJsonArtifact(path: string, value: unknown): Promise<void> {
    return this.artifactStore.writeJsonArtifact(path, value);
  }
}
