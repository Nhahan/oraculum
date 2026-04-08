import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAgentAdapter } from "../adapters/index.js";
import {
  type AgentRepairContext,
  type AgentRunResult,
  agentRunResultSchema,
} from "../adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateBaseSnapshotPath,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateRepairAttemptLogsDir,
  getCandidateRepairAttemptResultPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import { projectConfigSchema } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  type RunManifest,
  type RunRecommendation,
  roundManifestSchema,
  runManifestSchema,
} from "../domain/run.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { captureManagedProjectSnapshot } from "./base-snapshots.js";
import { recommendWinnerWithJudge } from "./finalist-judge.js";
import { writeFinalistComparisonReport } from "./finalist-report.js";
import { evaluateCandidateRound } from "./oracles.js";
import { loadProjectConfig, writeJsonFile } from "./project.js";
import { readRunManifest, writeLatestExportableRunState, writeLatestRunState } from "./runs.js";
import { detectWorkspaceMode, prepareCandidateWorkspace } from "./workspaces.js";

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

interface CandidateSelectionMetrics {
  candidateId: string;
  passCount: number;
  repairableCount: number;
  warningCount: number;
  errorCount: number;
  criticalCount: number;
  artifactCount: number;
}

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const manifest = await readRunManifest(projectRoot, options.runId);
  const projectConfig = manifest.configPath
    ? projectConfigSchema.parse(JSON.parse(await readFile(manifest.configPath, "utf8")) as unknown)
    : await loadProjectConfig(projectRoot);
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
  const selectionMetrics = new Map<string, CandidateSelectionMetrics>();
  const verdictsByCandidate = new Map<string, OracleVerdict[]>();

  for (const candidate of manifest.candidates) {
    const runningCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: "running",
    });
    await writeCandidateManifest(projectRoot, manifest.id, runningCandidate);

    const logDir = getCandidateLogsDir(projectRoot, manifest.id, candidate.id);
    let parsedResult: AgentRunResult;
    let workspaceMode = runningCandidate.workspaceMode;
    let baseRevision: string | undefined;
    let baseSnapshotPath: string | undefined;

    try {
      const intendedWorkspaceMode = await detectWorkspaceMode(projectRoot);
      if (intendedWorkspaceMode === "git-worktree") {
        baseRevision = await readProjectRevision(projectRoot);
      } else {
        baseSnapshotPath = getCandidateBaseSnapshotPath(projectRoot, manifest.id, candidate.id);
        const snapshot = await captureManagedProjectSnapshot(projectRoot);
        await writeJsonFile(baseSnapshotPath, snapshot);
      }

      const workspace = await prepareCandidateWorkspace({
        ...(baseRevision ? { baseRevision } : {}),
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
          ...(baseRevision ? { baseRevision } : {}),
          ...(baseSnapshotPath ? { baseSnapshotPath } : {}),
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
      ...(baseRevision ? { baseRevision } : {}),
      ...(baseSnapshotPath ? { baseSnapshotPath } : {}),
    });

    await writeCandidateManifest(projectRoot, manifest.id, updatedCandidate);
    candidateMap.set(updatedCandidate.id, updatedCandidate);
    executionRecords.push({
      candidate: updatedCandidate,
      result: parsedResult,
    });
    selectionMetrics.set(updatedCandidate.id, {
      candidateId: updatedCandidate.id,
      passCount: 0,
      repairableCount: 0,
      warningCount: 0,
      errorCount: 0,
      criticalCount: 0,
      artifactCount: parsedResult.artifacts.length,
    });
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

      let currentCandidate = candidateMap.get(record.candidate.id) ?? record.candidate;
      let currentResult = record.result;
      let evaluation = await evaluateCandidateRound({
        candidate: currentCandidate,
        projectConfig,
        projectRoot,
        result: currentResult,
        roundId: round.id,
        runId: manifest.id,
      });
      let repairAttempt = 0;

      while (
        currentResult.status === "completed" &&
        projectConfig.repair.enabled &&
        repairAttempt < projectConfig.repair.maxAttemptsPerRound &&
        hasRepairableVerdicts(evaluation.verdicts)
      ) {
        repairAttempt += 1;

        const repairLogDir = getCandidateRepairAttemptLogsDir(
          projectRoot,
          manifest.id,
          currentCandidate.id,
          round.id,
          repairAttempt,
        );
        let repairedResult: AgentRunResult;

        try {
          const taskPacket = materializedTaskPacketSchema.parse(
            JSON.parse(await readFile(currentCandidate.taskPacketPath, "utf8")) as unknown,
          );
          repairedResult = agentRunResultSchema.parse(
            await adapter.runCandidate({
              runId: manifest.id,
              candidateId: currentCandidate.id,
              strategyId: currentCandidate.strategyId,
              strategyLabel: currentCandidate.strategyLabel,
              workspaceDir: currentCandidate.workspaceDir,
              logDir: repairLogDir,
              taskPacket,
              repairContext: buildRepairContext(round.id, repairAttempt, evaluation.verdicts),
            }),
          );
        } catch (error) {
          repairedResult = await materializeExecutionFailure({
            adapter: manifest.agent,
            candidateId: currentCandidate.id,
            error,
            logDir: repairLogDir,
            runId: manifest.id,
          });
        }

        const repairResultPath = getCandidateRepairAttemptResultPath(
          projectRoot,
          manifest.id,
          currentCandidate.id,
          round.id,
          repairAttempt,
        );
        await writeJsonFile(repairResultPath, repairedResult);

        currentResult = repairedResult;
        record.result = repairedResult;
        const repairedRounds = new Set(currentCandidate.repairedRounds ?? []);
        repairedRounds.add(round.id);
        currentCandidate = candidateManifestSchema.parse({
          ...currentCandidate,
          status: repairedResult.status === "completed" ? "executed" : "failed",
          lastRunResultPath: repairResultPath,
          repairCount: (currentCandidate.repairCount ?? 0) + 1,
          repairedRounds: [...repairedRounds],
        });
        candidateMap.set(currentCandidate.id, currentCandidate);
        await writeCandidateManifest(projectRoot, manifest.id, currentCandidate);

        const metrics = selectionMetrics.get(currentCandidate.id);
        if (metrics) {
          metrics.artifactCount = repairedResult.artifacts.length;
        }

        evaluation = await evaluateCandidateRound({
          candidate: currentCandidate,
          projectConfig,
          projectRoot,
          result: currentResult,
          roundId: round.id,
          runId: manifest.id,
        });
      }

      verdictCount += evaluation.verdicts.length;
      const existingVerdicts = verdictsByCandidate.get(currentCandidate.id) ?? [];
      verdictsByCandidate.set(currentCandidate.id, [...existingVerdicts, ...evaluation.verdicts]);
      recordVerdictMetrics(selectionMetrics, currentCandidate.id, evaluation.verdicts);
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

  const taskPacketPath = manifest.candidates[0]?.taskPacketPath;
  candidateResults.push(...executionRecords.map((record) => record.result));
  const taskPacket = taskPacketPath
    ? materializedTaskPacketSchema.parse(
        JSON.parse(await readFile(taskPacketPath, "utf8")) as unknown,
      )
    : undefined;
  const judgeOutcome = taskPacket
    ? await recommendWinnerWithJudge({
        adapter,
        candidateResults,
        candidates: Array.from(candidateMap.values()),
        ...(manifest.profileSelection ? { consultationProfile: manifest.profileSelection } : {}),
        projectRoot,
        runId: manifest.id,
        taskPacket,
        verdictsByCandidate,
      })
    : { fallbackAllowed: true };
  const recommendedWinner =
    judgeOutcome.recommendation ??
    (judgeOutcome.fallbackAllowed
      ? chooseFallbackWinner(
          Array.from(candidateMap.values()),
          selectionMetrics,
          manifest.profileSelection,
        )
      : undefined);

  const completedManifest = runManifestSchema.parse({
    ...manifest,
    status: "completed",
    rounds: roundStates,
    candidates: Array.from(candidateMap.values()),
    ...(recommendedWinner ? { recommendedWinner } : {}),
  });
  await writeRunManifest(projectRoot, completedManifest);
  await writeLatestRunState(projectRoot, completedManifest.id);
  if (completedManifest.recommendedWinner) {
    await writeLatestExportableRunState(projectRoot, completedManifest.id);
  }
  await writeFinalistComparisonReport({
    agent: completedManifest.agent,
    candidateResults,
    candidates: completedManifest.candidates,
    projectRoot,
    ...(recommendedWinner ? { recommendedWinner } : {}),
    runId: completedManifest.id,
    taskPacket: completedManifest.taskPacket,
    verdictsByCandidate,
    ...(completedManifest.profileSelection
      ? { consultationProfile: completedManifest.profileSelection }
      : {}),
  });

  return {
    candidateResults,
    manifest: completedManifest,
  };
}

function hasRepairableVerdicts(verdicts: OracleVerdict[]): boolean {
  return verdicts.some((verdict) => verdict.status === "repairable");
}

function buildRepairContext(
  roundId: string,
  attempt: number,
  verdicts: OracleVerdict[],
): AgentRepairContext {
  const repairableVerdicts = verdicts.filter((verdict) => verdict.status === "repairable");

  return {
    roundId,
    attempt,
    verdicts: repairableVerdicts.map((verdict) => ({
      oracleId: verdict.oracleId,
      status: verdict.status,
      severity: verdict.severity,
      summary: verdict.summary,
      ...(verdict.repairHint ? { repairHint: verdict.repairHint } : {}),
    })),
    keyWitnesses: repairableVerdicts
      .flatMap((verdict) =>
        verdict.witnesses.map((witness) => ({
          title: witness.title,
          detail: witness.detail,
          kind: witness.kind,
        })),
      )
      .slice(0, 5),
  };
}

function recordVerdictMetrics(
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  candidateId: string,
  verdicts: OracleVerdict[],
): void {
  const metrics = metricsByCandidate.get(candidateId);
  if (!metrics) {
    return;
  }

  for (const verdict of verdicts) {
    if (verdict.status === "pass") {
      metrics.passCount += 1;
    } else if (verdict.status === "repairable") {
      metrics.repairableCount += 1;
    }

    if (verdict.severity === "warning") {
      metrics.warningCount += 1;
    } else if (verdict.severity === "error") {
      metrics.errorCount += 1;
    } else if (verdict.severity === "critical") {
      metrics.criticalCount += 1;
    }
  }
}

function chooseFallbackWinner(
  candidates: CandidateManifest[],
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  consultationProfile?: RunManifest["profileSelection"],
): RunRecommendation | undefined {
  const finalists = candidates.filter((candidate) => candidate.status === "promoted");
  if (finalists.length === 0) {
    return undefined;
  }

  const ranked = [...finalists].sort((left, right) => {
    const leftMetrics = metricsByCandidate.get(left.id);
    const rightMetrics = metricsByCandidate.get(right.id);

    const leftPenalty = buildPenalty(leftMetrics);
    const rightPenalty = buildPenalty(rightMetrics);
    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }

    const leftPassCount = leftMetrics?.passCount ?? 0;
    const rightPassCount = rightMetrics?.passCount ?? 0;
    if (leftPassCount !== rightPassCount) {
      return rightPassCount - leftPassCount;
    }

    const leftArtifactCount = leftMetrics?.artifactCount ?? 0;
    const rightArtifactCount = rightMetrics?.artifactCount ?? 0;
    if (leftArtifactCount !== rightArtifactCount) {
      return rightArtifactCount - leftArtifactCount;
    }

    return left.id.localeCompare(right.id);
  });

  const winner = ranked[0];
  if (!winner) {
    return undefined;
  }

  const winnerMetrics = metricsByCandidate.get(winner.id);
  const hasProfileGaps = Boolean(consultationProfile?.missingCapabilities.length);
  if (finalists.length === 1) {
    const confidence = hasProfileGaps ? "medium" : "high";
    return {
      candidateId: winner.id,
      confidence,
      summary: hasProfileGaps
        ? `Selected by fallback policy because ${winner.id} is the only surviving finalist, but the consultation profile still has validation gaps: ${consultationProfile?.missingCapabilities.join("; ")}.`
        : `Selected by fallback policy because ${winner.id} is the only surviving finalist.`,
      source: "fallback-policy",
    };
  }

  const runnerUp = ranked[1];
  const runnerUpMetrics = runnerUp ? metricsByCandidate.get(runnerUp.id) : undefined;
  const winnerPenalty = buildPenalty(winnerMetrics);
  const runnerUpPenalty = buildPenalty(runnerUpMetrics);
  const winnerPassCount = winnerMetrics?.passCount ?? 0;
  const runnerUpPassCount = runnerUpMetrics?.passCount ?? 0;
  let confidence: RunRecommendation["confidence"] =
    winnerPenalty < runnerUpPenalty || winnerPassCount > runnerUpPassCount ? "medium" : "low";
  if (hasProfileGaps) {
    confidence = "low";
  }

  return {
    candidateId: winner.id,
    confidence,
    summary:
      confidence === "medium"
        ? `Selected by fallback policy from ${finalists.length} finalists using current deterministic signals: fewer warnings/errors, stronger pass coverage, and better artifact coverage.`
        : hasProfileGaps
          ? `Selected by fallback policy from ${finalists.length} finalists, but deep validation coverage is incomplete: ${consultationProfile?.missingCapabilities.join("; ")}.`
          : `Selected by fallback policy from ${finalists.length} finalists; finalists were close, so confidence is limited.`,
    source: "fallback-policy",
  };
}

function buildPenalty(metrics: CandidateSelectionMetrics | undefined): number {
  if (!metrics) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    metrics.criticalCount * 1000 +
    metrics.errorCount * 100 +
    metrics.warningCount * 10 +
    metrics.repairableCount
  );
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

async function readProjectRevision(projectRoot: string): Promise<string> {
  const result = await runSubprocess({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`Failed to read project revision in ${projectRoot}.`);
  }

  return result.stdout.trim();
}
