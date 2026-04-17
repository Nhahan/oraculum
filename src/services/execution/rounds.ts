import type { AgentAdapter, AgentRunResult } from "../../adapters/types.js";
import { agentRunResultSchema } from "../../adapters/types.js";
import type { ProjectConfig } from "../../domain/config.js";
import type { OracleVerdict } from "../../domain/oracle.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  type RunManifest,
  roundManifestSchema,
} from "../../domain/run.js";
import {
  type ConsultProgressReporter,
  candidateEliminatedEvent,
  candidatePassedRoundEvent,
  candidateRetryingEvent,
  roundCompletedEvent,
  roundStartedEvent,
} from "../consult-progress.js";
import { evaluateCandidateRound } from "../oracles.js";
import type { RunStore } from "../run-store.js";
import { materializeExecutionFailure } from "./failure.js";
import { recordVerdictMetrics } from "./metrics.js";
import { writeCandidateManifest, writeRunManifest } from "./persistence.js";
import { buildRepairContext, hasRepairableVerdicts } from "./repair.js";
import { evaluateEligibleConsultationPlanStages } from "./scorecards.js";
import type { CandidateExecutionRecord, CandidateSelectionMetrics } from "./shared.js";

export async function runExecutionRounds(options: {
  adapter: AgentAdapter;
  candidateMap: Map<string, CandidateManifest>;
  consultationPlan?: ConsultationPlanArtifact;
  executionGraphEnabled: boolean;
  executionRecords: CandidateExecutionRecord[];
  manifest: RunManifest;
  onProgress?: ConsultProgressReporter | undefined;
  projectConfig: ProjectConfig;
  projectRoot: string;
  scorecardsByCandidate: Map<string, CandidateScorecard>;
  selectionMetrics: Map<string, CandidateSelectionMetrics>;
  store: RunStore;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}): Promise<{ manifest: RunManifest; roundStates: RunManifest["rounds"] }> {
  let manifest = options.manifest;
  const roundStates = manifest.rounds.map((round) => ({ ...round }));
  const survivors = new Set(options.executionRecords.map((record) => record.candidate.id));
  const completedRoundIds = new Set<string>();
  const candidatePositions = new Map(
    options.manifest.candidates.map((candidate, index) => [candidate.id, index + 1]),
  );
  const totalCandidateCount = options.manifest.candidates.length;

  for (const [index, round] of roundStates.entries()) {
    const candidatesEnteringRound = survivors.size;
    await options.onProgress?.(roundStartedEvent(round.id, round.label, candidatesEnteringRound));
    const startedAt = new Date().toISOString();
    roundStates[index] = {
      ...round,
      status: "running",
      startedAt,
    };
    manifest = await writeRunManifest(options.store, {
      ...manifest,
      status: "running",
      rounds: roundStates,
      candidates: Array.from(options.candidateMap.values()),
    });

    let verdictCount = 0;
    let eliminatedCount = 0;
    let survivorCount = 0;

    for (const record of options.executionRecords) {
      if (!survivors.has(record.candidate.id)) {
        continue;
      }

      let currentCandidate = options.candidateMap.get(record.candidate.id) ?? record.candidate;
      let currentResult = record.result;
      let evaluation = await evaluateCandidateRound({
        candidate: currentCandidate,
        projectConfig: options.projectConfig,
        projectRoot: options.projectRoot,
        result: currentResult,
        roundId: round.id,
        runId: manifest.id,
        taskPacket: record.taskPacket,
        ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
      });
      const repairHistoryVerdicts: OracleVerdict[] = [];
      let repairAttempt = 0;

      while (
        currentResult.status === "completed" &&
        options.projectConfig.repair.enabled &&
        repairAttempt < options.projectConfig.repair.maxAttemptsPerRound &&
        hasRepairableVerdicts(evaluation.verdicts)
      ) {
        repairHistoryVerdicts.push(...evaluation.verdicts);
        repairAttempt += 1;
        const candidatePosition = candidatePositions.get(currentCandidate.id) ?? 0;
        await options.onProgress?.(
          candidateRetryingEvent({
            candidateId: currentCandidate.id,
            candidateIndex: candidatePosition,
            candidateCount: totalCandidateCount,
            repairAttempt,
            roundId: round.id,
            roundLabel: round.label,
          }),
        );

        const repairLogDir = options.store.getCandidateRepairAttemptLogsDir(
          manifest.id,
          currentCandidate.id,
          round.id,
          repairAttempt,
        );
        let repairedResult: AgentRunResult;

        try {
          repairedResult = agentRunResultSchema.parse(
            await options.adapter.runCandidate({
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

        const repairResultPath = options.store.getCandidateRepairAttemptResultPath(
          manifest.id,
          currentCandidate.id,
          round.id,
          repairAttempt,
        );
        await options.store.writeCandidateRepairAttemptResult(
          manifest.id,
          currentCandidate.id,
          round.id,
          repairAttempt,
          repairedResult,
        );

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
        options.candidateMap.set(currentCandidate.id, currentCandidate);
        await writeCandidateManifest(options.store, manifest.id, currentCandidate);

        const metrics = options.selectionMetrics.get(currentCandidate.id);
        if (metrics) {
          metrics.artifactCount = repairedResult.artifacts.length;
        }

        evaluation = await evaluateCandidateRound({
          candidate: currentCandidate,
          projectConfig: options.projectConfig,
          projectRoot: options.projectRoot,
          result: currentResult,
          roundId: round.id,
          runId: manifest.id,
          taskPacket: record.taskPacket,
          ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
        });
      }

      const combinedVerdicts = [...repairHistoryVerdicts, ...evaluation.verdicts];
      verdictCount += combinedVerdicts.length;
      const existingVerdicts = options.verdictsByCandidate.get(currentCandidate.id) ?? [];
      options.verdictsByCandidate.set(currentCandidate.id, [
        ...existingVerdicts,
        ...combinedVerdicts,
      ]);
      recordVerdictMetrics(options.selectionMetrics, currentCandidate.id, combinedVerdicts);
      await Promise.all([
        ...evaluation.verdicts.map((verdict) =>
          options.store.writeCandidateVerdict(manifest.id, currentCandidate.id, round.id, verdict),
        ),
        ...evaluation.witnesses.map((witness) =>
          options.store.writeCandidateWitness(manifest.id, currentCandidate.id, round.id, witness),
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
        const candidatePosition = candidatePositions.get(currentCandidate.id) ?? 0;
        await options.onProgress?.(
          candidateEliminatedEvent({
            candidateId: currentCandidate.id,
            candidateIndex: candidatePosition,
            candidateCount: totalCandidateCount,
            roundId: round.id,
            roundLabel: round.label,
          }),
        );
      } else {
        survivorCount += 1;
        const candidatePosition = candidatePositions.get(currentCandidate.id) ?? 0;
        await options.onProgress?.(
          candidatePassedRoundEvent({
            candidateId: currentCandidate.id,
            candidateIndex: candidatePosition,
            candidateCount: totalCandidateCount,
            roundId: round.id,
            roundLabel: round.label,
          }),
        );
      }

      options.candidateMap.set(nextCandidate.id, nextCandidate);
      await writeCandidateManifest(options.store, manifest.id, nextCandidate);
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
    if (options.executionGraphEnabled && options.consultationPlan) {
      const stageEffects = await evaluateEligibleConsultationPlanStages({
        candidateMap: options.candidateMap,
        completedRoundIds,
        consultationPlan: options.consultationPlan,
        executionRecords: options.executionRecords,
        projectConfig: options.projectConfig,
        projectRoot: options.projectRoot,
        runId: manifest.id,
        scorecardsByCandidate: options.scorecardsByCandidate,
        selectionMetrics: options.selectionMetrics,
        store: options.store,
        survivors,
        verdictsByCandidate: options.verdictsByCandidate,
      });
      roundStates[index] = roundManifestSchema.parse({
        ...roundStates[index],
        verdictCount: roundStates[index].verdictCount + stageEffects.verdictCount,
        eliminatedCount: roundStates[index].eliminatedCount + stageEffects.eliminatedCount,
        survivorCount: Math.max(0, roundStates[index].survivorCount - stageEffects.eliminatedCount),
      });
      if (index < roundStates.length - 1) {
        manifest = await writeRunManifest(options.store, {
          ...manifest,
          status: "running",
          rounds: roundStates,
          candidates: Array.from(options.candidateMap.values()),
        });
      }
    }
    await options.onProgress?.(
      roundCompletedEvent(round.id, round.label, survivors.size, candidatesEnteringRound),
    );
  }

  return { manifest, roundStates };
}
