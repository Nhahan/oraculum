import { readFile } from "node:fs/promises";

import { createAgentAdapter } from "../adapters/index.js";
import type { AgentRunResult } from "../adapters/types.js";
import { OraculumError } from "../core/errors.js";
import { projectConfigSchema } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import { isPreflightBlockedConsultation, type RunManifest } from "../domain/run.js";
import {
  type ConsultProgressReporter,
  candidatesLaunchingEvent,
  comparingFinalistsEvent,
  noSurvivorsEvent,
  secondOpinionRecordedEvent,
  secondOpinionRequestedEvent,
  verdictReadyEvent,
} from "./consult-progress.js";
import { executeInitialCandidates } from "./execution/initial-candidates.js";
import { writeRunManifest } from "./execution/persistence.js";
import { runExecutionRounds } from "./execution/rounds.js";
import { isExecutionGraphEnabled } from "./execution/scorecards.js";
import { chooseFallbackWinner, resolveSecondOpinionAdapterName } from "./execution/selection.js";
import { writeFailureAnalysis } from "./failure-analysis.js";
import { recommendSecondOpinionWithJudge, recommendWinnerWithJudge } from "./finalist-judge.js";
import { writeFinalistComparisonReport } from "./finalist-report.js";
import { loadProjectConfig } from "./project.js";
import { RunStore } from "./run-store.js";
import { readRunManifest, writeLatestExportableRunState, writeLatestRunState } from "./runs.js";
import { readConsultationPlanArtifact } from "./task-packets.js";

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
  await options.onProgress?.(candidatesLaunchingEvent(manifest.candidateCount));

  const verdictsByCandidate = new Map<string, OracleVerdict[]>();
  const executionGraphEnabled = isExecutionGraphEnabled(consultationPlan);
  const { candidateMap, executionRecords, scorecardsByCandidate, selectionMetrics } =
    await executeInitialCandidates({
      adapter,
      ...(consultationPlan ? { consultationPlan } : {}),
      executionGraphEnabled,
      manifest,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      projectConfig,
      projectRoot,
      store,
    });
  const roundExecution = await runExecutionRounds({
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
  manifest = roundExecution.manifest;

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

export { rankFallbackCandidates } from "./execution/selection.js";
