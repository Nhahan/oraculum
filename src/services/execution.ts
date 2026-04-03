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
  runManifestSchema,
} from "../domain/run.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { evaluateCandidateOracles } from "./oracles.js";
import { writeJsonFile } from "./project.js";
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

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const projectRoot = resolveProjectRoot(options.cwd);
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
  const updatedCandidates: CandidateManifest[] = [];

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

    const evaluation = evaluateCandidateOracles({
      candidate,
      result: parsedResult,
    });
    await Promise.all([
      ...evaluation.verdicts.map(async (verdict) =>
        writeJsonFile(
          getCandidateVerdictPath(projectRoot, manifest.id, candidate.id, verdict.oracleId),
          verdict,
        ),
      ),
      ...evaluation.witnesses.map(async (witness) =>
        writeJsonFile(
          getCandidateWitnessPath(projectRoot, manifest.id, candidate.id, witness.id),
          witness,
        ),
      ),
    ]);

    const updatedCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: evaluation.promote ? "promoted" : "eliminated",
      lastRunResultPath: resultPath,
      ...(workspaceMode ? { workspaceMode } : {}),
    });

    await writeCandidateManifest(projectRoot, manifest.id, updatedCandidate);
    updatedCandidates.push(updatedCandidate);
    candidateResults.push(parsedResult);
  }

  const completedManifest = runManifestSchema.parse({
    ...manifest,
    status: "completed",
    candidates: updatedCandidates,
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
