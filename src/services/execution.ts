import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAgentAdapter } from "../adapters/index.js";
import { type AgentRunResult, agentRunResultSchema } from "../adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../core/paths.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  type RunManifest,
  roundManifestSchema,
  runManifestSchema,
} from "../domain/run.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { evaluateCandidateRound } from "./oracles.js";
import { loadProjectConfig, writeJsonFile } from "./project.js";
import { readRunManifest } from "./runs.js";
import { prepareCandidateWorkspace } from "./workspaces.js";

interface ExecuteRunOptions {
  claudeBinaryPath?: string;
  codexBinaryPath?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  runId: string;
  timeoutMs?: number;
}

export interface ExecuteRunResult {
  candidateResults: AgentRunResult[];
  manifest: RunManifest;
}

interface CandidateExecutionRecord {
  candidate: CandidateManifest;
  result: AgentRunResult;
}

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const projectConfig = await loadProjectConfig(projectRoot);
  const manifest = await readRunManifest(projectRoot, options.runId);
  const adapter = createAgentAdapter(manifest.agent, {
    ...(options.claudeBinaryPath ? { claudeBinaryPath: options.claudeBinaryPath } : {}),
    ...(options.codexBinaryPath ? { codexBinaryPath: options.codexBinaryPath } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  manifest.status = "running";
  await writeRunManifest(projectRoot, manifest);

  const candidateResults: AgentRunResult[] = [];
  const executionRecords: CandidateExecutionRecord[] = [];
  const candidateMap = new Map<string, CandidateManifest>();

  for (const candidate of manifest.candidates) {
    const runningCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: "running",
    });
    await writeCandidateManifest(projectRoot, manifest.id, runningCandidate);

    const logDir = getCandidateLogsDir(projectRoot, manifest.id, candidate.id);
    let parsedResult: AgentRunResult;
    let workspaceMode = runningCandidate.workspaceMode;

    try {
      const workspace = await prepareCandidateWorkspace({
        projectRoot,
        workspaceDir: candidate.workspaceDir,
      });
      workspaceMode = workspace.mode;

      await writeCandidateManifest(
        projectRoot,
        manifest.id,
        candidateManifestSchema.parse({
          ...runningCandidate,
          workspaceMode,
        }),
      );

      const taskPacket = materializedTaskPacketSchema.parse(
        JSON.parse(await readFile(candidate.taskPacketPath, "utf8")) as unknown,
      );

      const result = await adapter.runCandidate({
        runId: manifest.id,
        candidateId: candidate.id,
        strategyId: candidate.strategyId,
        strategyLabel: candidate.strategyLabel,
        workspaceDir: candidate.workspaceDir,
        logDir,
        taskPacket,
      });

      parsedResult = agentRunResultSchema.parse(result);
    } catch (error) {
      parsedResult = await materializeExecutionFailure({
        adapter: manifest.agent,
        candidateId: candidate.id,
        error,
        logDir,
        runId: manifest.id,
      });
    }

    const resultPath = getCandidateAgentResultPath(projectRoot, manifest.id, candidate.id);
    await writeJsonFile(resultPath, parsedResult);

    const updatedCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: parsedResult.status === "completed" ? "executed" : "failed",
      lastRunResultPath: resultPath,
      ...(workspaceMode ? { workspaceMode } : {}),
    });

    await writeCandidateManifest(projectRoot, manifest.id, updatedCandidate);
    candidateMap.set(updatedCandidate.id, updatedCandidate);
    executionRecords.push({
      candidate: updatedCandidate,
      result: parsedResult,
    });
    candidateResults.push(parsedResult);
  }

  const roundStates = manifest.rounds.map((round) => ({ ...round }));
  const survivors = new Set(executionRecords.map((record) => record.candidate.id));

  for (const [index, round] of roundStates.entries()) {
    const startedAt = new Date().toISOString();
    roundStates[index] = {
      ...round,
      status: "running",
      startedAt,
    };
    await writeRunManifest(
      projectRoot,
      runManifestSchema.parse({
        ...manifest,
        status: "running",
        rounds: roundStates,
        candidates: Array.from(candidateMap.values()),
      }),
    );

    let verdictCount = 0;
    let eliminatedCount = 0;
    let survivorCount = 0;

    for (const record of executionRecords) {
      if (!survivors.has(record.candidate.id)) {
        continue;
      }

      const currentCandidate = candidateMap.get(record.candidate.id) ?? record.candidate;
      const evaluation = await evaluateCandidateRound({
        candidate: currentCandidate,
        projectConfig,
        projectRoot,
        result: record.result,
        roundId: round.id,
        runId: manifest.id,
      });

      verdictCount += evaluation.verdicts.length;
      await Promise.all([
        ...evaluation.verdicts.map(async (verdict) =>
          writeJsonFile(
            getCandidateVerdictPath(
              projectRoot,
              manifest.id,
              currentCandidate.id,
              round.id,
              verdict.oracleId,
            ),
            verdict,
          ),
        ),
        ...evaluation.witnesses.map(async (witness) =>
          writeJsonFile(
            getCandidateWitnessPath(
              projectRoot,
              manifest.id,
              currentCandidate.id,
              round.id,
              witness.id,
            ),
            witness,
          ),
        ),
      ]);

      const survives = evaluation.survives;
      const isLastRound = index === roundStates.length - 1;
      const nextCandidate = candidateManifestSchema.parse({
        ...currentCandidate,
        status: survives ? (isLastRound ? "promoted" : "judged") : "eliminated",
      });

      if (!survives) {
        survivors.delete(currentCandidate.id);
        eliminatedCount += 1;
      } else {
        survivorCount += 1;
      }

      candidateMap.set(nextCandidate.id, nextCandidate);
      await writeCandidateManifest(projectRoot, manifest.id, nextCandidate);
    }

    roundStates[index] = roundManifestSchema.parse({
      ...roundStates[index],
      status: "completed",
      verdictCount,
      survivorCount,
      eliminatedCount,
      completedAt: new Date().toISOString(),
    });
  }

  const completedManifest = runManifestSchema.parse({
    ...manifest,
    status: "completed",
    rounds: roundStates,
    candidates: Array.from(candidateMap.values()),
  });
  await writeRunManifest(projectRoot, completedManifest);

  return {
    candidateResults,
    manifest: completedManifest,
  };
}

async function writeRunManifest(projectRoot: string, manifest: RunManifest): Promise<void> {
  await writeJsonFile(getRunManifestPath(projectRoot, manifest.id), manifest);
}

async function writeCandidateManifest(
  projectRoot: string,
  runId: string,
  candidate: CandidateManifest,
): Promise<void> {
  await writeJsonFile(getCandidateManifestPath(projectRoot, runId, candidate.id), candidate);
}

interface MaterializeExecutionFailureOptions {
  adapter: AgentRunResult["adapter"];
  candidateId: string;
  error: unknown;
  logDir: string;
  runId: string;
}

async function materializeExecutionFailure(
  options: MaterializeExecutionFailureOptions,
): Promise<AgentRunResult> {
  const errorMessage =
    options.error instanceof Error ? options.error.message : String(options.error);
  const errorPath = join(options.logDir, "execution-error.txt");
  const timestamp = new Date().toISOString();

  await mkdir(options.logDir, { recursive: true });
  await writeFile(errorPath, `${errorMessage}\n`, "utf8");

  return agentRunResultSchema.parse({
    runId: options.runId,
    candidateId: options.candidateId,
    adapter: options.adapter,
    status: "failed",
    startedAt: timestamp,
    completedAt: timestamp,
    exitCode: 1,
    summary: errorMessage,
    artifacts: [{ kind: "log", path: errorPath }],
  });
}
