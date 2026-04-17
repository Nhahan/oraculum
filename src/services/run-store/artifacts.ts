import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";

import type { ZodTypeAny, z } from "zod";

import { agentRunResultSchema } from "../../adapters/types.js";
import { OraculumError } from "../../core/errors.js";
import type { OracleVerdict, Witness } from "../../domain/oracle.js";
import { toCanonicalConsultationProfileSelection } from "../../domain/profile.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  candidateManifestSchema,
  candidateScorecardSchema,
  type RunManifest,
  runManifestSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import { materializedTaskPacketSchema } from "../../domain/task.js";
import { pathExists, writeJsonFile } from "../project.js";
import { parseRunManifestArtifact } from "../run-manifest-artifact.js";
import type { RunPathStore } from "./paths.js";
import type { CandidateArtifactPaths, RunArtifactPaths } from "./types.js";

export class RunArtifactStore {
  readonly paths: RunPathStore;

  constructor(paths: RunPathStore) {
    this.paths = paths;
  }

  async ensureRunDirectories(runId: string): Promise<RunArtifactPaths> {
    const runPaths = this.paths.getRunPaths(runId);
    await Promise.all([
      mkdir(runPaths.runDir, { recursive: true }),
      mkdir(runPaths.reportsDir, { recursive: true }),
    ]);
    return runPaths;
  }

  async ensureCandidateDirectories(
    runId: string,
    candidateId: string,
  ): Promise<CandidateArtifactPaths> {
    const candidatePaths = this.paths.getCandidatePaths(runId, candidateId);
    await Promise.all([
      mkdir(candidatePaths.candidateDir, { recursive: true }),
      mkdir(candidatePaths.workspaceDir, { recursive: true }),
      mkdir(candidatePaths.verdictsDir, { recursive: true }),
      mkdir(candidatePaths.witnessesDir, { recursive: true }),
      mkdir(candidatePaths.logsDir, { recursive: true }),
    ]);
    return candidatePaths;
  }

  async readRunManifest(runId: string): Promise<RunManifest> {
    const manifestPath = this.paths.getRunPaths(runId).manifestPath;
    if (!(await pathExists(manifestPath))) {
      throw new OraculumError(`Consultation record not found: ${manifestPath}`);
    }

    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return parseRunManifestArtifact(raw);
  }

  async writeRunManifest(manifest: RunManifest): Promise<void> {
    const parsedManifest = runManifestSchema.parse(manifest);
    await this.writeJsonArtifact(this.paths.getRunPaths(manifest.id).manifestPath, {
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
      this.paths.getCandidatePaths(runId, candidate.id).manifestPath,
      candidateManifestSchema.parse(candidate),
    );
  }

  async readCandidateTaskPacket(
    runId: string,
    candidateId: string,
  ): Promise<MaterializedTaskPacket> {
    const taskPacketPath = this.paths.getCandidatePaths(runId, candidateId).taskPacketPath;
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
      this.paths.getCandidatePaths(runId, candidateId).taskPacketPath,
      materializedTaskPacketSchema.parse(taskPacket),
    );
  }

  async readCandidateScorecard(
    runId: string,
    candidateId: string,
  ): Promise<CandidateScorecard | undefined> {
    const scorecardPath = this.paths.getCandidatePaths(runId, candidateId).scorecardPath;
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
      this.paths.getCandidatePaths(runId, candidateId).scorecardPath,
      candidateScorecardSchema.parse(scorecard),
    );
  }

  async writeCandidateAgentResult(
    runId: string,
    candidateId: string,
    result: z.infer<typeof agentRunResultSchema>,
  ): Promise<void> {
    await this.writeJsonArtifact(
      this.paths.getCandidatePaths(runId, candidateId).agentResultPath,
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
      this.paths.getCandidateRepairAttemptResultPath(runId, candidateId, roundId, attempt),
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
      this.paths.getCandidateVerdictPath(runId, candidateId, roundId, verdict.oracleId),
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
      this.paths.getCandidateWitnessPath(runId, candidateId, roundId, witness.id),
      witness,
    );
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
