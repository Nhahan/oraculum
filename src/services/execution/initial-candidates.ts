import type { AgentAdapter, AgentRunResult } from "../../adapters/types.js";
import { agentRunResultSchema } from "../../adapters/types.js";
import type { ProjectConfig } from "../../domain/config.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  type RunManifest,
} from "../../domain/run.js";
import { captureManagedProjectSnapshot } from "../base-snapshots.js";
import {
  type ConsultProgressReporter,
  candidateFailedBeforeChecksEvent,
  candidateReadyForChecksEvent,
  candidateRunningEvent,
} from "../consult-progress.js";
import type { RunStore } from "../run-store.js";
import { detectWorkspaceMode, prepareCandidateWorkspace } from "../workspaces.js";
import { materializeExecutionFailure, readProjectRevision } from "./failure.js";
import { writeCandidateManifest } from "./persistence.js";
import { createInitialCandidateScorecard } from "./scorecards.js";
import {
  type CandidateExecutionRecord,
  type CandidateSelectionMetrics,
  createCandidateSelectionMetrics,
} from "./shared.js";

export async function executeInitialCandidates(options: {
  adapter: AgentAdapter;
  consultationPlan?: ConsultationPlanArtifact;
  executionGraphEnabled: boolean;
  manifest: RunManifest;
  onProgress?: ConsultProgressReporter | undefined;
  projectConfig: ProjectConfig;
  projectRoot: string;
  store: RunStore;
}): Promise<{
  candidateMap: Map<string, CandidateManifest>;
  executionRecords: CandidateExecutionRecord[];
  scorecardsByCandidate: Map<string, CandidateScorecard>;
  selectionMetrics: Map<string, CandidateSelectionMetrics>;
}> {
  const candidateMap = new Map<string, CandidateManifest>();
  const executionRecords: CandidateExecutionRecord[] = [];
  const selectionMetrics = new Map<string, CandidateSelectionMetrics>();
  const scorecardsByCandidate = new Map<string, CandidateScorecard>();
  const candidateCount = options.manifest.candidates.length;

  for (const [candidateIndex, candidate] of options.manifest.candidates.entries()) {
    const currentCandidateIndex = candidateIndex + 1;
    await options.onProgress?.(
      candidateRunningEvent(candidate.id, currentCandidateIndex, candidateCount),
    );
    const runningCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: "running",
    });
    await writeCandidateManifest(options.store, options.manifest.id, runningCandidate);

    const candidatePaths = options.store.getCandidatePaths(options.manifest.id, candidate.id);
    const logDir = candidatePaths.logsDir;
    const taskPacket = await options.store.readCandidateTaskPacket(
      options.manifest.id,
      candidate.id,
    );
    let parsedResult: AgentRunResult;
    let workspaceMode = runningCandidate.workspaceMode;
    let baseRevision: string | undefined;
    let baseSnapshotPath: string | undefined;

    try {
      const intendedWorkspaceMode = await detectWorkspaceMode(options.projectRoot);
      if (intendedWorkspaceMode === "git-worktree") {
        baseRevision = await readProjectRevision(options.projectRoot);
      } else {
        baseSnapshotPath = candidatePaths.baseSnapshotPath;
        const snapshot = await captureManagedProjectSnapshot(options.projectRoot, {
          rules: options.projectConfig.managedTree,
        });
        await options.store.writeJsonArtifact(baseSnapshotPath, snapshot);
      }

      const workspace = await prepareCandidateWorkspace({
        ...(baseRevision ? { baseRevision } : {}),
        managedTreeRules: options.projectConfig.managedTree,
        projectRoot: options.projectRoot,
        workspaceDir: candidate.workspaceDir,
      });
      workspaceMode = workspace.mode;

      await writeCandidateManifest(
        options.store,
        options.manifest.id,
        candidateManifestSchema.parse({
          ...runningCandidate,
          workspaceMode,
          ...(baseRevision ? { baseRevision } : {}),
          ...(baseSnapshotPath ? { baseSnapshotPath } : {}),
        }),
      );

      const result = await options.adapter.runCandidate({
        runId: options.manifest.id,
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
        adapter: options.manifest.agent,
        candidateId: candidate.id,
        error,
        logDir,
        runId: options.manifest.id,
      });
    }

    await options.store.writeCandidateAgentResult(options.manifest.id, candidate.id, parsedResult);
    await options.onProgress?.(
      parsedResult.status === "completed"
        ? candidateReadyForChecksEvent(candidate.id, currentCandidateIndex, candidateCount)
        : candidateFailedBeforeChecksEvent(candidate.id, currentCandidateIndex, candidateCount),
    );

    const updatedCandidate = candidateManifestSchema.parse({
      ...candidate,
      status: parsedResult.status === "completed" ? "executed" : "failed",
      lastRunResultPath: candidatePaths.agentResultPath,
      ...(workspaceMode ? { workspaceMode } : {}),
      ...(baseRevision ? { baseRevision } : {}),
      ...(baseSnapshotPath ? { baseSnapshotPath } : {}),
    });

    await writeCandidateManifest(options.store, options.manifest.id, updatedCandidate);
    candidateMap.set(updatedCandidate.id, updatedCandidate);
    executionRecords.push({
      candidate: updatedCandidate,
      result: parsedResult,
      taskPacket,
    });
    selectionMetrics.set(
      updatedCandidate.id,
      createCandidateSelectionMetrics(updatedCandidate.id, parsedResult.artifacts.length),
    );
    if (options.executionGraphEnabled && options.consultationPlan) {
      const scorecard = createInitialCandidateScorecard(
        updatedCandidate.id,
        options.consultationPlan,
        parsedResult,
      );
      scorecardsByCandidate.set(updatedCandidate.id, scorecard);
      await options.store.writeCandidateScorecard(
        options.manifest.id,
        updatedCandidate.id,
        scorecard,
      );
    }
  }

  return {
    candidateMap,
    executionRecords,
    scorecardsByCandidate,
    selectionMetrics,
  };
}
