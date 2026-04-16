import type { AgentRunResult } from "../../adapters/types.js";
import type { ProjectConfig } from "../../domain/config.js";
import type { OracleVerdict } from "../../domain/oracle.js";
import {
  type CandidateManifest,
  type CandidateScorecard,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  candidateScorecardSchema,
} from "../../domain/run.js";
import { evaluateConsultationPlanStage } from "../oracles.js";
import type { RunStore } from "../run-store.js";
import { recordVerdictMetrics } from "./metrics.js";
import { writeCandidateManifest } from "./persistence.js";
import type { CandidateExecutionRecord, CandidateSelectionMetrics } from "./shared.js";

export function isExecutionGraphEnabled(
  consultationPlan: ConsultationPlanArtifact | undefined,
): consultationPlan is ConsultationPlanArtifact {
  return (
    consultationPlan !== undefined &&
    consultationPlan.mode !== "standard" &&
    consultationPlan.stagePlan.length > 0 &&
    consultationPlan.workstreams.length > 0
  );
}

export function createInitialCandidateScorecard(
  candidateId: string,
  consultationPlan: ConsultationPlanArtifact,
  result: AgentRunResult,
): CandidateScorecard {
  return candidateScorecardSchema.parse({
    candidateId,
    mode: consultationPlan.mode,
    stageResults: [],
    violations: [],
    unresolvedRisks: [],
    artifactCoherence: deriveCandidateArtifactCoherence(result),
    reversibility: "unknown",
  });
}

export async function evaluateEligibleConsultationPlanStages(options: {
  candidateMap: Map<string, CandidateManifest>;
  completedRoundIds: Set<string>;
  consultationPlan: ConsultationPlanArtifact;
  executionRecords: CandidateExecutionRecord[];
  projectConfig: ProjectConfig;
  projectRoot: string;
  runId: string;
  scorecardsByCandidate: Map<string, CandidateScorecard>;
  selectionMetrics: Map<string, CandidateSelectionMetrics>;
  store: RunStore;
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
      createInitialCandidateScorecard(currentCandidate.id, options.consultationPlan, record.result);

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
          ...stageEvaluation.verdicts.map((verdict) =>
            options.store.writeCandidateVerdict(
              options.runId,
              currentCandidate.id,
              stageEvaluation.roundId,
              verdict,
            ),
          ),
          ...stageEvaluation.witnesses.map((witness) =>
            options.store.writeCandidateWitness(
              options.runId,
              currentCandidate.id,
              stageEvaluation.roundId,
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
        await options.store.writeCandidateScorecard(options.runId, currentCandidate.id, scorecard);

        if (stageEvaluation.stageResult.status !== "pass") {
          options.survivors.delete(currentCandidate.id);
          eliminatedCount += 1;
          currentCandidate = candidateManifestSchema.parse({
            ...currentCandidate,
            status: "eliminated",
          });
          options.candidateMap.set(currentCandidate.id, currentCandidate);
          await writeCandidateManifest(options.store, options.runId, currentCandidate);
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

export function deriveCandidateArtifactCoherence(
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
