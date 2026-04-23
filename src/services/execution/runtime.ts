import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createAgentAdapter } from "../../adapters/index.js";
import { agentRunResultSchema, type AgentRunResult } from "../../adapters/types.js";
import { OraculumError } from "../../core/errors.js";
import { projectConfigSchema } from "../../domain/config.js";
import { oracleVerdictSchema, type OracleVerdict } from "../../domain/oracle.js";
import {
  candidateManifestSchema,
  isPreflightBlockedConsultation,
  type RunManifest,
} from "../../domain/run.js";
import {
  type ConsultProgressReporter,
  candidatesLaunchingEvent,
  comparingFinalistsEvent,
  noSurvivorsEvent,
  secondOpinionRecordedEvent,
  secondOpinionRequestedEvent,
  verdictReadyEvent,
} from "../consult-progress.js";
import { writeFailureAnalysis } from "../failure-analysis.js";
import { recommendSecondOpinionWithJudge, recommendWinnerWithJudge } from "../finalist-judge.js";
import { writeFinalistComparisonReport } from "../finalist-report.js";
import { loadProjectConfig } from "../project.js";
import { RunStore } from "../run-store.js";
import { readRunManifest, writeLatestExportableRunState, writeLatestRunState } from "../runs.js";
import {
  finalizeUnimplementedSpecCandidates,
  markBackupSpecSelected,
  prepareSpecSearch,
} from "../spec-search/index.js";
import { readConsultationPlanArtifact } from "../task-packets.js";
import { executeInitialCandidates } from "./initial-candidates.js";
import { recordVerdictMetrics } from "./metrics.js";
import { writeRunManifest } from "./persistence.js";
import { runExecutionRounds } from "./rounds.js";
import { isExecutionGraphEnabled } from "./scorecards.js";
import { chooseFallbackWinner, resolveSecondOpinionAdapterName } from "./selection.js";
import {
  createCandidateSelectionMetrics,
  type CandidateExecutionRecord,
  type CandidateSelectionMetrics,
} from "./shared.js";

interface ExecuteRunOptions {
  claudeBinaryPath?: string;
  codexBinaryPath?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onProgress?: ConsultProgressReporter | undefined;
  runId: string;
  timeoutMs?: number;
}

export interface ExecuteRunResult {
  candidateResults: AgentRunResult[];
  manifest: RunManifest;
}

type CandidateState = RunManifest["candidates"][number];
type CandidateScorecardMap = Map<
  string,
  NonNullable<Awaited<ReturnType<RunStore["readCandidateScorecard"]>>>
>;

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const store = new RunStore(options.cwd);
  const projectRoot = store.projectRoot;
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
  manifest = await writeRunManifest(store, manifest);

  const executionGraphEnabled = isExecutionGraphEnabled(consultationPlan);
  const resumedState = await restoreRunningExecutionState({
    executionGraphEnabled,
    manifest,
    store,
  });

  let verdictsByCandidate = resumedState?.verdictsByCandidate ?? new Map<string, OracleVerdict[]>();
  let candidateMap =
    resumedState?.candidateMap ??
    new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  let executionRecords = resumedState?.executionRecords ?? [];
  let scorecardsByCandidate = resumedState?.scorecardsByCandidate ?? new Map();
  let selectionMetrics = resumedState?.selectionMetrics ?? new Map();
  let backupCandidateIds = resumedState?.backupCandidateIds ?? [];
  let implementationCandidateIds = resumedState?.implementationCandidateIds ?? [];

  if (resumedState) {
    manifest = resumedState.manifest;
  } else {
    const specSearch = await prepareSpecSearch({
      adapter,
      ...(consultationPlan ? { consultationPlan } : {}),
      manifest,
      projectRoot,
      store,
    });
    manifest = specSearch.manifest;
    candidateMap = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
    backupCandidateIds = specSearch.backupCandidateIds;
    implementationCandidateIds = specSearch.implementationCandidateIds;
  }

  if (implementationCandidateIds.length > 0) {
    await options.onProgress?.(candidatesLaunchingEvent(implementationCandidateIds.length));
    mergeExecutionState(
      {
        candidateMap,
        executionRecords,
        scorecardsByCandidate,
        selectionMetrics,
      },
      await executeInitialCandidates({
        adapter,
        candidateIdsToExecute: implementationCandidateIds,
        ...(consultationPlan ? { consultationPlan } : {}),
        executionGraphEnabled,
        manifest,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        projectConfig,
        projectRoot,
        store,
      }),
    );
  }

  let roundExecution = await runExecutionRounds({
    adapter,
    candidateMap,
    ...(consultationPlan ? { consultationPlan } : {}),
    executionGraphEnabled,
    executionRecords,
    manifest,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    projectConfig,
    projectRoot,
    scorecardsByCandidate,
    selectionMetrics,
    store,
    verdictsByCandidate,
  });
  manifest = {
    ...roundExecution.manifest,
    rounds: roundExecution.roundStates,
    candidates: Array.from(candidateMap.values()),
  };

  if (!hasPromotedCandidate(candidateMap) && backupCandidateIds.length > 0) {
    const [backupCandidateId] = backupCandidateIds;
    if (backupCandidateId) {
      manifest = await markBackupSpecSelected({
        candidateId: backupCandidateId,
        manifest,
        reason:
          "Backup implementation triggered because earlier selected spec did not produce a crownable survivor.",
        store,
      });
      await options.onProgress?.(candidatesLaunchingEvent(1));
      const backupExecution = await executeInitialCandidates({
        adapter,
        candidateIdsToExecute: [backupCandidateId],
        ...(consultationPlan ? { consultationPlan } : {}),
        executionGraphEnabled,
        manifest,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        projectConfig,
        projectRoot,
        store,
      });
      candidateMap = backupExecution.candidateMap;
      executionRecords = [...executionRecords, ...backupExecution.executionRecords];
      for (const [candidateId, metrics] of backupExecution.selectionMetrics) {
        selectionMetrics.set(candidateId, metrics);
      }
      for (const [candidateId, scorecard] of backupExecution.scorecardsByCandidate) {
        scorecardsByCandidate.set(candidateId, scorecard);
      }
      roundExecution = await runExecutionRounds({
        adapter,
        candidateMap,
        ...(consultationPlan ? { consultationPlan } : {}),
        executionGraphEnabled,
        executionRecords: backupExecution.executionRecords,
        manifest,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        projectConfig,
        projectRoot,
        scorecardsByCandidate,
        selectionMetrics,
        store,
        verdictsByCandidate,
        accumulateRoundCounts: true,
      });
      manifest = {
        ...roundExecution.manifest,
        rounds: roundExecution.roundStates,
        candidates: Array.from(candidateMap.values()),
      };
    }
  }

  manifest = await finalizeUnimplementedSpecCandidates({
    manifest,
    store,
  });
  candidateMap = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));

  const candidateResults = executionRecords.map((record) => record.result);
  const finalists = Array.from(candidateMap.values()).filter(
    (candidate) => candidate.status === "promoted",
  );
  await options.onProgress?.(
    finalists.length > 0 ? comparingFinalistsEvent(finalists.length) : noSurvivorsEvent(),
  );
  const taskPacket = manifest.candidates[0]
    ? await store.readCandidateTaskPacket(manifest.id, manifest.candidates[0].id)
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
    await options.onProgress?.(secondOpinionRequestedEvent());
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
    await options.onProgress?.(secondOpinionRecordedEvent());
  }

  const completedManifest = await writeRunManifest(store, {
    ...manifest,
    status: "completed",
    rounds: roundExecution.roundStates,
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
  await options.onProgress?.(verdictReadyEvent());

  return {
    candidateResults,
    manifest: completedManifest,
  };
}

export { rankFallbackCandidates } from "./selection.js";

function hasPromotedCandidate(candidateMap: Map<string, { status: string }>): boolean {
  return Array.from(candidateMap.values()).some((candidate) => candidate.status === "promoted");
}

interface RestoredExecutionState {
  backupCandidateIds: string[];
  candidateMap: Map<string, CandidateState>;
  executionRecords: CandidateExecutionRecord[];
  implementationCandidateIds: string[];
  manifest: RunManifest;
  scorecardsByCandidate: CandidateScorecardMap;
  selectionMetrics: Map<string, CandidateSelectionMetrics>;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}

async function restoreRunningExecutionState(options: {
  executionGraphEnabled: boolean;
  manifest: RunManifest;
  store: RunStore;
}): Promise<RestoredExecutionState | undefined> {
  if (options.manifest.status !== "running") {
    return undefined;
  }

  const hydratedCandidates = await hydratePersistedCandidates(options.store, options.manifest);
  const manifest = {
    ...options.manifest,
    candidates: hydratedCandidates,
  };

  if (!hasExecutionCheckpoint(manifest)) {
    return undefined;
  }

  const candidateMap = new Map(hydratedCandidates.map((candidate) => [candidate.id, candidate]));
  const executionRecords: CandidateExecutionRecord[] = [];
  const scorecardsByCandidate: CandidateScorecardMap = new Map();
  const selectionMetrics = new Map<string, CandidateSelectionMetrics>();
  const verdictsByCandidate = new Map<string, OracleVerdict[]>();

  for (const candidate of hydratedCandidates) {
    const restoredRecord = await restoreCandidateExecutionRecord(options.store, manifest.id, candidate);
    if (restoredRecord) {
      executionRecords.push(restoredRecord.executionRecord);
      selectionMetrics.set(candidate.id, restoredRecord.metrics);
      verdictsByCandidate.set(candidate.id, restoredRecord.verdicts);
    }

    if (!options.executionGraphEnabled) {
      continue;
    }

    const scorecard = await options.store.readCandidateScorecard(manifest.id, candidate.id);
    if (scorecard) {
      scorecardsByCandidate.set(candidate.id, scorecard);
    }
  }

  return {
    backupCandidateIds: getPendingBackupCandidateIds(manifest),
    candidateMap,
    executionRecords,
    implementationCandidateIds: getPendingImplementationCandidateIds(manifest),
    manifest,
    scorecardsByCandidate,
    selectionMetrics,
    verdictsByCandidate,
  };
}

async function hydratePersistedCandidates(
  store: RunStore,
  manifest: RunManifest,
): Promise<RunManifest["candidates"]> {
  const candidates = await Promise.all(
    manifest.candidates.map(async (candidate) => {
      const candidatePath = store.getCandidatePaths(manifest.id, candidate.id).manifestPath;
      return (await store.readOptionalParsedArtifact(candidatePath, candidateManifestSchema)) ?? candidate;
    }),
  );

  return candidates;
}

async function restoreCandidateExecutionRecord(
  store: RunStore,
  runId: string,
  candidate: CandidateState,
): Promise<
  | {
      executionRecord: CandidateExecutionRecord;
      metrics: CandidateSelectionMetrics;
      verdicts: OracleVerdict[];
    }
  | undefined
> {
  if (!candidate.lastRunResultPath) {
    if (requiresPersistedExecutionRecord(candidate)) {
      throw new OraculumError(
        `Cannot resume consultation "${runId}" because candidate "${candidate.id}" is missing its persisted agent result.`,
      );
    }
    return undefined;
  }

  const result = await store.readOptionalParsedArtifact(
    candidate.lastRunResultPath,
    agentRunResultSchema,
  );
  if (!result) {
    if (requiresPersistedExecutionRecord(candidate)) {
      throw new OraculumError(
        `Cannot resume consultation "${runId}" because candidate "${candidate.id}" has an invalid or unreadable persisted agent result at ${candidate.lastRunResultPath}.`,
      );
    }
    return undefined;
  }

  const verdicts = await loadPersistedCandidateVerdicts(store, runId, candidate.id);
  const metrics = createCandidateSelectionMetrics(candidate.id, result.artifacts.length);
  recordVerdictMetrics(new Map([[candidate.id, metrics]]), candidate.id, verdicts);

  return {
    executionRecord: {
      candidate,
      result,
      taskPacket: await store.readCandidateTaskPacket(runId, candidate.id),
    },
    metrics,
    verdicts,
  };
}

async function loadPersistedCandidateVerdicts(
  store: RunStore,
  runId: string,
  candidateId: string,
): Promise<OracleVerdict[]> {
  const verdictsDir = store.getCandidatePaths(runId, candidateId).verdictsDir;
  const entries = await readdir(verdictsDir, { withFileTypes: true }).catch(() => []);
  const verdicts = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) =>
        store.readOptionalParsedArtifact(join(verdictsDir, entry.name), oracleVerdictSchema),
      ),
  );

  return verdicts.filter((verdict): verdict is OracleVerdict => Boolean(verdict));
}

function hasExecutionCheckpoint(manifest: RunManifest): boolean {
  return (
    manifest.searchStrategy !== undefined ||
    manifest.rounds.some((round) => round.status !== "pending") ||
    manifest.candidates.some(
      (candidate) =>
        candidate.status !== "planned" ||
        candidate.lastRunResultPath !== undefined ||
        candidate.specPath !== undefined,
    )
  );
}

function getPendingImplementationCandidateIds(manifest: RunManifest): string[] {
  return manifest.candidates
    .filter((candidate) => {
      if (candidate.status !== "planned" && candidate.status !== "running") {
        return false;
      }

      if (candidate.lastRunResultPath) {
        return false;
      }

      if (manifest.searchStrategy !== "spec-first") {
        return true;
      }

      return candidate.specSelected === true || candidate.specPath === undefined;
    })
    .map((candidate) => candidate.id);
}

function getPendingBackupCandidateIds(manifest: RunManifest): string[] {
  if (manifest.searchStrategy !== "spec-first") {
    return [];
  }

  return manifest.candidates
    .filter(
      (candidate) =>
        candidate.status === "planned" &&
        candidate.specPath !== undefined &&
        candidate.specSelected !== true,
    )
    .map((candidate) => candidate.id);
}

function requiresPersistedExecutionRecord(candidate: RunManifest["candidates"][number]): boolean {
  return (
    candidate.status === "executed" ||
    candidate.status === "failed" ||
    candidate.status === "judged" ||
    candidate.status === "eliminated" ||
    candidate.status === "promoted" ||
    candidate.status === "exported"
  );
}

function mergeExecutionState(
  current: {
    candidateMap: Map<string, CandidateState>;
    executionRecords: CandidateExecutionRecord[];
    scorecardsByCandidate: CandidateScorecardMap;
    selectionMetrics: Map<string, CandidateSelectionMetrics>;
  },
  update: {
    candidateMap: Map<string, CandidateState>;
    executionRecords: CandidateExecutionRecord[];
    scorecardsByCandidate: CandidateScorecardMap;
    selectionMetrics: Map<string, CandidateSelectionMetrics>;
  },
): void {
  for (const [candidateId, candidate] of update.candidateMap) {
    current.candidateMap.set(candidateId, candidate);
  }

  const recordsByCandidate = new Map(
    current.executionRecords.map((record) => [record.candidate.id, record]),
  );
  for (const record of update.executionRecords) {
    recordsByCandidate.set(record.candidate.id, record);
  }
  current.executionRecords.length = 0;
  current.executionRecords.push(...recordsByCandidate.values());

  for (const [candidateId, scorecard] of update.scorecardsByCandidate) {
    current.scorecardsByCandidate.set(candidateId, scorecard);
  }
  for (const [candidateId, metrics] of update.selectionMetrics) {
    current.selectionMetrics.set(candidateId, metrics);
  }
}
