import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAgentAdapter } from "../adapters/index.js";
import {
  type AgentRepairContext,
  type AgentRunResult,
  agentRunResultSchema,
} from "../adapters/types.js";
import { OraculumError } from "../core/errors.js";
import {
  getCandidateAgentResultPath,
  getCandidateBaseSnapshotPath,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateRepairAttemptLogsDir,
  getCandidateRepairAttemptResultPath,
  getCandidateScorecardPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import { type Adapter, type ProjectConfig, projectConfigSchema } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import {
  getValidationGaps,
  getValidationProfileId,
  toCanonicalConsultationProfileSelection,
} from "../domain/profile.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  candidateScorecardSchema,
  deriveConsultationOutcomeForManifest,
  isPreflightBlockedConsultation,
  type RunManifest,
  type RunRecommendation,
  roundManifestSchema,
  runManifestSchema,
} from "../domain/run.js";
import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../domain/task.js";

import { captureManagedProjectSnapshot } from "./base-snapshots.js";
import { writeFailureAnalysis } from "./failure-analysis.js";
import { recommendSecondOpinionWithJudge, recommendWinnerWithJudge } from "./finalist-judge.js";
import { writeFinalistComparisonReport } from "./finalist-report.js";
import { evaluateCandidateRound, evaluateConsultationPlanStage } from "./oracles.js";
import { loadProjectConfig, writeJsonFile } from "./project.js";
import { readRunManifest, writeLatestExportableRunState, writeLatestRunState } from "./runs.js";
import { readConsultationPlanArtifact } from "./task-packets.js";
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
  taskPacket: MaterializedTaskPacket;
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
  let manifest = await readRunManifest(projectRoot, options.runId);
  if (isPreflightBlockedConsultation(manifest)) {
    throw new OraculumError(
      `Consultation "${manifest.id}" is blocked by preflight decision "${manifest.preflight?.decision}".`,
    );
  }
  const projectConfig = manifest.configPath
    ? projectConfigSchema.parse(JSON.parse(await readFile(manifest.configPath, "utf8")) as unknown)
    : await loadProjectConfig(projectRoot);
  const adapterFactoryOptions = {
    ...(options.claudeBinaryPath ? { claudeBinaryPath: options.claudeBinaryPath } : {}),
    ...(options.codexBinaryPath ? { codexBinaryPath: options.codexBinaryPath } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  const adapter = createAgentAdapter(manifest.agent, adapterFactoryOptions);
  const consultationPlan = await readConsultationPlanArtifact(manifest.taskPath);
  if (manifest.taskPacket.sourceKind === "consultation-plan" && !consultationPlan) {
    throw new OraculumError(
      `Consultation "${manifest.id}" references a missing or invalid consultation plan artifact: ${manifest.taskPath}`,
    );
  }
  const secondOpinionAdapterName = projectConfig.judge.secondOpinion.enabled
    ? resolveSecondOpinionAdapterName(
        manifest.agent,
        projectConfig.adapters,
        projectConfig.judge.secondOpinion.adapter,
      )
    : undefined;
  const secondOpinionAdapter = secondOpinionAdapterName
    ? secondOpinionAdapterName === manifest.agent
      ? adapter
      : createAgentAdapter(secondOpinionAdapterName, adapterFactoryOptions)
    : undefined;

  manifest.status = "running";
  manifest = await writeRunManifest(projectRoot, manifest);

  const candidateResults: AgentRunResult[] = [];
  const executionRecords: CandidateExecutionRecord[] = [];
  const candidateMap = new Map<string, CandidateManifest>();
  const selectionMetrics = new Map<string, CandidateSelectionMetrics>();
  const verdictsByCandidate = new Map<string, OracleVerdict[]>();
  const scorecardsByCandidate = new Map<string, CandidateScorecard>();
  const executionGraphEnabled = isExecutionGraphEnabled(consultationPlan);

  for (const candidate of manifest.candidates) {
    const runningCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: "running",
    });
    await writeCandidateManifest(projectRoot, manifest.id, runningCandidate);

    const logDir = getCandidateLogsDir(projectRoot, manifest.id, candidate.id);
    const taskPacket = materializedTaskPacketSchema.parse(
      JSON.parse(await readFile(candidate.taskPacketPath, "utf8")) as unknown,
    );
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
        const snapshot = await captureManagedProjectSnapshot(projectRoot, {
          rules: projectConfig.managedTree,
        });
        await writeJsonFile(baseSnapshotPath, snapshot);
      }

      const workspace = await prepareCandidateWorkspace({
        ...(baseRevision ? { baseRevision } : {}),
        managedTreeRules: projectConfig.managedTree,
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
      taskPacket,
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
    if (executionGraphEnabled && consultationPlan) {
      const scorecard = candidateScorecardSchema.parse({
        candidateId: updatedCandidate.id,
        mode: consultationPlan.mode,
        stageResults: [],
        violations: [],
        unresolvedRisks: [],
        artifactCoherence: deriveCandidateArtifactCoherence(parsedResult),
        reversibility: "unknown",
      });
      scorecardsByCandidate.set(updatedCandidate.id, scorecard);
      await writeJsonFile(
        getCandidateScorecardPath(projectRoot, manifest.id, updatedCandidate.id),
        scorecard,
      );
    }
  }

  const roundStates = manifest.rounds.map((round) => ({ ...round }));
  const survivors = new Set(executionRecords.map((record) => record.candidate.id));
  const completedRoundIds = new Set<string>();

  for (const [index, round] of roundStates.entries()) {
    const startedAt = new Date().toISOString();
    roundStates[index] = {
      ...round,
      status: "running",
      startedAt,
    };
    manifest = await writeRunManifest(projectRoot, {
      ...manifest,
      status: "running",
      rounds: roundStates,
      candidates: Array.from(candidateMap.values()),
    });

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
        taskPacket: record.taskPacket,
        ...(consultationPlan ? { consultationPlan } : {}),
      });
      const repairHistoryVerdicts: OracleVerdict[] = [];
      let repairAttempt = 0;

      while (
        currentResult.status === "completed" &&
        projectConfig.repair.enabled &&
        repairAttempt < projectConfig.repair.maxAttemptsPerRound &&
        hasRepairableVerdicts(evaluation.verdicts)
      ) {
        repairHistoryVerdicts.push(...evaluation.verdicts);
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
          repairedResult = agentRunResultSchema.parse(
            await adapter.runCandidate({
              runId: manifest.id,
              candidateId: currentCandidate.id,
              strategyId: currentCandidate.strategyId,
              strategyLabel: currentCandidate.strategyLabel,
              workspaceDir: currentCandidate.workspaceDir,
              logDir: repairLogDir,
              taskPacket: record.taskPacket,
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
          taskPacket: record.taskPacket,
          ...(consultationPlan ? { consultationPlan } : {}),
        });
      }

      const combinedVerdicts = [...repairHistoryVerdicts, ...evaluation.verdicts];
      verdictCount += combinedVerdicts.length;
      const existingVerdicts = verdictsByCandidate.get(currentCandidate.id) ?? [];
      verdictsByCandidate.set(currentCandidate.id, [...existingVerdicts, ...combinedVerdicts]);
      recordVerdictMetrics(selectionMetrics, currentCandidate.id, combinedVerdicts);
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
    completedRoundIds.add(round.id);
    if (executionGraphEnabled && consultationPlan) {
      const stageEffects = await evaluateEligibleConsultationPlanStages({
        candidateMap,
        completedRoundIds,
        consultationPlan,
        executionRecords,
        projectConfig,
        projectRoot,
        runId: manifest.id,
        scorecardsByCandidate,
        selectionMetrics,
        survivors,
        verdictsByCandidate,
      });
      roundStates[index] = roundManifestSchema.parse({
        ...roundStates[index],
        verdictCount: roundStates[index].verdictCount + stageEffects.verdictCount,
        eliminatedCount: roundStates[index].eliminatedCount + stageEffects.eliminatedCount,
        survivorCount: Math.max(0, roundStates[index].survivorCount - stageEffects.eliminatedCount),
      });
      if (index < roundStates.length - 1) {
        manifest = await writeRunManifest(projectRoot, {
          ...manifest,
          status: "running",
          rounds: roundStates,
          candidates: Array.from(candidateMap.values()),
        });
      }
    }
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
        ...(consultationPlan ? { consultationPlan } : {}),
        ...(manifest.profileSelection ? { consultationProfile: manifest.profileSelection } : {}),
        projectRoot,
        runId: manifest.id,
        taskPacket,
        managedTreeRules: projectConfig.managedTree,
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
          scorecardsByCandidate,
        )
      : undefined);
  if (taskPacket && secondOpinionAdapter && projectConfig.judge.secondOpinion.enabled) {
    await recommendSecondOpinionWithJudge({
      adapter: secondOpinionAdapter,
      candidateResults,
      candidates: Array.from(candidateMap.values()),
      ...(consultationPlan ? { consultationPlan } : {}),
      ...(manifest.profileSelection ? { consultationProfile: manifest.profileSelection } : {}),
      managedTreeRules: projectConfig.managedTree,
      ...(judgeOutcome.judgeResult ? { primaryJudgeResult: judgeOutcome.judgeResult } : {}),
      ...(recommendedWinner ? { primaryRecommendation: recommendedWinner } : {}),
      projectRoot,
      runId: manifest.id,
      secondOpinion: projectConfig.judge.secondOpinion,
      taskPacket,
      verdictsByCandidate,
    });
  }

  const completedManifest = await writeRunManifest(projectRoot, {
    ...manifest,
    status: "completed",
    rounds: roundStates,
    candidates: Array.from(candidateMap.values()),
    ...(recommendedWinner ? { recommendedWinner } : {}),
  });
  await writeFinalistComparisonReport({
    agent: completedManifest.agent,
    candidateResults,
    candidates: completedManifest.candidates,
    projectRoot,
    ...(recommendedWinner ? { recommendedWinner } : {}),
    runId: completedManifest.id,
    taskPacket: completedManifest.taskPacket,
    ...(completedManifest.preflight ? { preflight: completedManifest.preflight } : {}),
    verificationLevel: completedManifest.outcome?.verificationLevel ?? "none",
    managedTreeRules: projectConfig.managedTree,
    verdictsByCandidate,
    ...(completedManifest.profileSelection
      ? { consultationProfile: completedManifest.profileSelection }
      : {}),
  });
  await writeFailureAnalysis({
    judgeAbstained: !judgeOutcome.recommendation && !judgeOutcome.fallbackAllowed,
    manifest: completedManifest,
    maxRepairAttemptsPerRound: projectConfig.repair.maxAttemptsPerRound,
    projectRoot,
    verdictsByCandidate,
  });
  await writeLatestRunState(projectRoot, completedManifest.id);
  if (completedManifest.recommendedWinner) {
    await writeLatestExportableRunState(projectRoot, completedManifest.id);
  }

  return {
    candidateResults,
    manifest: completedManifest,
  };
}

function resolveSecondOpinionAdapterName(
  primaryAdapter: Adapter,
  enabledAdapters: Adapter[],
  configuredAdapter: Adapter | undefined,
): Adapter {
  if (configuredAdapter && enabledAdapters.includes(configuredAdapter)) {
    return configuredAdapter;
  }

  const alternateAdapter = primaryAdapter === "claude-code" ? "codex" : "claude-code";
  return enabledAdapters.includes(alternateAdapter) ? alternateAdapter : primaryAdapter;
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
  scorecardsByCandidate?: Map<string, CandidateScorecard>,
): RunRecommendation | undefined {
  const finalists = candidates.filter((candidate) => candidate.status === "promoted");
  if (finalists.length === 0) {
    return undefined;
  }

  const ranked = rankFallbackCandidates(finalists, metricsByCandidate, scorecardsByCandidate);

  const winner = ranked[0];
  if (!winner) {
    return undefined;
  }

  const winnerMetrics = metricsByCandidate.get(winner.id);
  const validationGaps = getValidationGaps(consultationProfile);
  const validationProfileId = getValidationProfileId(consultationProfile);
  const hasProfileGaps = validationGaps.length > 0;
  if (finalists.length === 1) {
    const confidence = hasProfileGaps ? "medium" : "high";
    return {
      candidateId: winner.id,
      confidence,
      summary: hasProfileGaps
        ? `Selected by fallback policy because ${winner.id} is the only surviving finalist, but the selected validation posture${validationProfileId ? ` (${validationProfileId})` : ""} still has validation gaps: ${validationGaps.join("; ")}.`
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
          ? `Selected by fallback policy from ${finalists.length} finalists, but the selected validation posture${validationProfileId ? ` (${validationProfileId})` : ""} still has validation gaps: ${validationGaps.join("; ")}.`
          : `Selected by fallback policy from ${finalists.length} finalists; finalists were close, so confidence is limited.`,
    source: "fallback-policy",
  };
}

export function rankFallbackCandidates(
  finalists: CandidateManifest[],
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  scorecardsByCandidate?: Map<string, CandidateScorecard>,
): CandidateManifest[] {
  return [...finalists].sort((left, right) => {
    const leftMetrics = metricsByCandidate.get(left.id);
    const rightMetrics = metricsByCandidate.get(right.id);

    const scorecardComparison = compareFallbackScorecards(
      scorecardsByCandidate?.get(left.id),
      scorecardsByCandidate?.get(right.id),
    );
    if (scorecardComparison !== 0) {
      return scorecardComparison;
    }

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
}

function compareFallbackScorecards(
  left: CandidateScorecard | undefined,
  right: CandidateScorecard | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (left && !right) {
    return -1;
  }
  if (!left && right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const leftPenalty = buildScorecardPenalty(left);
  const rightPenalty = buildScorecardPenalty(right);
  if (leftPenalty !== rightPenalty) {
    return leftPenalty - rightPenalty;
  }

  const leftCoverage = countCoveredWorkstreams(left);
  const rightCoverage = countCoveredWorkstreams(right);
  if (leftCoverage !== rightCoverage) {
    return rightCoverage - leftCoverage;
  }

  const leftPassStages = countPassingStages(left);
  const rightPassStages = countPassingStages(right);
  if (leftPassStages !== rightPassStages) {
    return rightPassStages - leftPassStages;
  }

  const leftRiskCount = left.unresolvedRisks.length;
  const rightRiskCount = right.unresolvedRisks.length;
  if (leftRiskCount !== rightRiskCount) {
    return leftRiskCount - rightRiskCount;
  }

  if (left.artifactCoherence !== right.artifactCoherence) {
    return (
      rankArtifactCoherence(right.artifactCoherence) - rankArtifactCoherence(left.artifactCoherence)
    );
  }

  return 0;
}

function buildScorecardPenalty(scorecard: CandidateScorecard): number {
  return (
    countNonPassingStages(scorecard) * 1_000 +
    scorecard.violations.length * 100 +
    scorecard.unresolvedRisks.length * 10
  );
}

function countCoveredWorkstreams(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.reduce(
    (total, stageResult) =>
      total +
      Object.values(stageResult.workstreamCoverage).filter((status) => status === "covered").length,
    0,
  );
}

function countPassingStages(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.filter((stageResult) => stageResult.status === "pass").length;
}

function countNonPassingStages(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.filter((stageResult) => stageResult.status !== "pass").length;
}

function rankArtifactCoherence(coherence: CandidateScorecard["artifactCoherence"]): number {
  switch (coherence) {
    case "strong":
      return 3;
    case "weak":
      return 2;
    case "unknown":
      return 1;
  }
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

async function writeRunManifest(projectRoot: string, manifest: RunManifest): Promise<RunManifest> {
  const updatedAt = new Date().toISOString();
  const persisted = runManifestSchema.parse({
    ...manifest,
    updatedAt,
    outcome: deriveConsultationOutcomeForManifest(manifest),
  });
  await writeJsonFile(getRunManifestPath(projectRoot, manifest.id), {
    ...persisted,
    ...(persisted.profileSelection
      ? { profileSelection: toCanonicalConsultationProfileSelection(persisted.profileSelection) }
      : {}),
  });
  return persisted;
}

async function writeCandidateManifest(
  projectRoot: string,
  runId: string,
  candidate: CandidateManifest,
): Promise<void> {
  await writeJsonFile(getCandidateManifestPath(projectRoot, runId, candidate.id), candidate);
}

function isExecutionGraphEnabled(
  consultationPlan: ConsultationPlanArtifact | undefined,
): consultationPlan is ConsultationPlanArtifact {
  return (
    consultationPlan !== undefined &&
    consultationPlan.mode !== "standard" &&
    consultationPlan.stagePlan.length > 0 &&
    consultationPlan.workstreams.length > 0
  );
}

async function evaluateEligibleConsultationPlanStages(options: {
  candidateMap: Map<string, CandidateManifest>;
  completedRoundIds: Set<string>;
  consultationPlan: ConsultationPlanArtifact;
  executionRecords: CandidateExecutionRecord[];
  projectConfig: ProjectConfig;
  projectRoot: string;
  runId: string;
  scorecardsByCandidate: Map<string, CandidateScorecard>;
  selectionMetrics: Map<string, CandidateSelectionMetrics>;
  survivors: Set<string>;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}): Promise<{ eliminatedCount: number; verdictCount: number }> {
  let eliminatedCount = 0;
  let verdictCount = 0;

  for (const record of options.executionRecords) {
    if (!options.survivors.has(record.candidate.id)) {
      continue;
    }

    let currentCandidate = options.candidateMap.get(record.candidate.id) ?? record.candidate;
    let scorecard =
      options.scorecardsByCandidate.get(record.candidate.id) ??
      candidateScorecardSchema.parse({
        candidateId: currentCandidate.id,
        mode: options.consultationPlan.mode,
        stageResults: [],
        violations: [],
        unresolvedRisks: [],
        artifactCoherence: deriveCandidateArtifactCoherence(record.result),
        reversibility: "unknown",
      });

    let progress = true;
    while (progress && options.survivors.has(currentCandidate.id)) {
      progress = false;
      for (const stage of options.consultationPlan.stagePlan) {
        if (scorecard.stageResults.some((stageResult) => stageResult.stageId === stage.id)) {
          continue;
        }
        if (!stage.roundIds.every((roundId) => options.completedRoundIds.has(roundId))) {
          continue;
        }
        if (
          !stage.dependsOn.every((dependencyId) =>
            scorecard.stageResults.some(
              (stageResult) =>
                stageResult.stageId === dependencyId && stageResult.status === "pass",
            ),
          )
        ) {
          continue;
        }

        const stageEvaluation = await evaluateConsultationPlanStage({
          candidate: currentCandidate,
          completedStageResults: scorecard.stageResults,
          consultationPlan: options.consultationPlan,
          existingVerdicts: options.verdictsByCandidate.get(currentCandidate.id) ?? [],
          projectConfig: options.projectConfig,
          projectRoot: options.projectRoot,
          result: record.result,
          runId: options.runId,
          stage,
        });
        const nextVerdicts = [
          ...(options.verdictsByCandidate.get(currentCandidate.id) ?? []),
          ...stageEvaluation.verdicts,
        ];
        options.verdictsByCandidate.set(currentCandidate.id, nextVerdicts);
        verdictCount += stageEvaluation.verdicts.length;
        recordVerdictMetrics(
          options.selectionMetrics,
          currentCandidate.id,
          stageEvaluation.verdicts,
        );
        await Promise.all([
          ...stageEvaluation.verdicts.map(async (verdict) =>
            writeJsonFile(
              getCandidateVerdictPath(
                options.projectRoot,
                options.runId,
                currentCandidate.id,
                stageEvaluation.roundId,
                verdict.oracleId,
              ),
              verdict,
            ),
          ),
          ...stageEvaluation.witnesses.map(async (witness) =>
            writeJsonFile(
              getCandidateWitnessPath(
                options.projectRoot,
                options.runId,
                currentCandidate.id,
                stageEvaluation.roundId,
                witness.id,
              ),
              witness,
            ),
          ),
        ]);

        scorecard = candidateScorecardSchema.parse({
          ...scorecard,
          stageResults: [...scorecard.stageResults, stageEvaluation.stageResult],
          violations: uniqueStrings([
            ...scorecard.violations,
            ...stageEvaluation.stageResult.violations,
          ]),
          unresolvedRisks: uniqueStrings([
            ...scorecard.unresolvedRisks,
            ...stageEvaluation.stageResult.unresolvedRisks,
          ]),
          artifactCoherence: deriveCandidateArtifactCoherence(record.result),
        });
        options.scorecardsByCandidate.set(currentCandidate.id, scorecard);
        await writeJsonFile(
          getCandidateScorecardPath(options.projectRoot, options.runId, currentCandidate.id),
          scorecard,
        );

        if (stageEvaluation.stageResult.status !== "pass") {
          options.survivors.delete(currentCandidate.id);
          eliminatedCount += 1;
          currentCandidate = candidateManifestSchema.parse({
            ...currentCandidate,
            status: "eliminated",
          });
          options.candidateMap.set(currentCandidate.id, currentCandidate);
          await writeCandidateManifest(options.projectRoot, options.runId, currentCandidate);
        }

        progress = true;
        break;
      }
    }
  }

  return {
    eliminatedCount,
    verdictCount,
  };
}

function deriveCandidateArtifactCoherence(
  result: AgentRunResult,
): CandidateScorecard["artifactCoherence"] {
  const reviewableKinds = new Set(["stdout", "transcript", "report", "patch"]);
  if (result.artifacts.some((artifact) => reviewableKinds.has(artifact.kind))) {
    return "strong";
  }
  if (
    result.artifacts.some((artifact) => artifact.kind !== "prompt" && artifact.kind !== "stderr")
  ) {
    return "weak";
  }
  return "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
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
