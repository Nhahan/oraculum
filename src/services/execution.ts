import { readFile } from "node:fs/promises";

import { createAgentAdapter } from "../adapters/index.js";
import { type AgentRunResult, agentRunResultSchema } from "../adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateLogsDir,
  getCandidateManifestPath,
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
    const workspace = await prepareCandidateWorkspace({
      projectRoot,
      workspaceDir: candidate.workspaceDir,
    });

    const taskPacket = materializedTaskPacketSchema.parse(
      JSON.parse(await readFile(candidate.taskPacketPath, "utf8")) as unknown,
    );

    const runningCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: "running",
      workspaceMode: workspace.mode,
    });
    await writeCandidateManifest(projectRoot, manifest.id, runningCandidate);

    const result = await adapter.runCandidate({
      runId: manifest.id,
      candidateId: candidate.id,
      strategyId: candidate.strategyId,
      strategyLabel: candidate.strategyLabel,
      workspaceDir: candidate.workspaceDir,
      logDir: getCandidateLogsDir(projectRoot, manifest.id, candidate.id),
      taskPacket,
    });

    const parsedResult = agentRunResultSchema.parse(result);
    const resultPath = getCandidateAgentResultPath(projectRoot, manifest.id, candidate.id);
    await writeJsonFile(resultPath, parsedResult);

    const updatedCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: parsedResult.status === "completed" ? "executed" : "failed",
      lastRunResultPath: resultPath,
      workspaceMode: workspace.mode,
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
