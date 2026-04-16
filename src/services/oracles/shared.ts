import { normalize } from "node:path";

import type { AgentRunResult } from "../../adapters/types.js";
import type { ProjectConfig, RoundId } from "../../domain/config.js";
import type { OracleVerdict, Witness } from "../../domain/oracle.js";
import type {
  CandidateManifest,
  CandidateScorecardStageResult,
  ConsultationPlanArtifact,
  ConsultationPlanStage,
  ConsultationPlanWorkstream,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

export interface EvaluateCandidateRoundOptions {
  candidate: CandidateManifest;
  projectConfig: ProjectConfig;
  projectRoot: string;
  result: AgentRunResult;
  roundId: RoundId;
  runId: string;
  taskPacket: MaterializedTaskPacket;
  consultationPlan?: ConsultationPlanArtifact;
}

export interface EvaluateCandidateRoundResult {
  survives: boolean;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

export interface OracleEvaluation {
  verdict: OracleVerdict;
  witnesses: Witness[];
}

export interface OracleDefinition {
  evaluate(options: EvaluateCandidateRoundOptions): Promise<OracleEvaluation> | OracleEvaluation;
  oracleId: string;
  roundId: RoundId;
}

export interface EvaluateConsultationPlanStageOptions {
  candidate: CandidateManifest;
  completedStageResults: CandidateScorecardStageResult[];
  consultationPlan: ConsultationPlanArtifact;
  existingVerdicts: OracleVerdict[];
  projectConfig: ProjectConfig;
  projectRoot: string;
  result: AgentRunResult;
  runId: string;
  stage: ConsultationPlanStage;
}

export interface EvaluateConsultationPlanStageResult {
  roundId: RoundId;
  stageResult: CandidateScorecardStageResult;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

export function normalizeProjectRelativePath(targetPath: string): string {
  const normalized = normalize(targetPath).replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function hasWorkstreamCoverage(
  workstream: ConsultationPlanWorkstream,
  changedPaths: string[],
): boolean {
  const requiredChangedPaths = workstream.requiredChangedPaths.map(normalizeProjectRelativePath);
  if (requiredChangedPaths.length > 0) {
    return requiredChangedPaths.every((targetPath) => changedPaths.includes(targetPath));
  }

  const targetArtifacts = workstream.targetArtifacts.map(normalizeProjectRelativePath);
  if (targetArtifacts.length > 0) {
    return targetArtifacts.some((targetPath) => changedPaths.includes(targetPath));
  }

  return false;
}
