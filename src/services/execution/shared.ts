import type { AgentRunResult } from "../../adapters/types.js";
import type { CandidateManifest } from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

export interface CandidateExecutionRecord {
  candidate: CandidateManifest;
  result: AgentRunResult;
  taskPacket: MaterializedTaskPacket;
}

export interface CandidateSelectionMetrics {
  candidateId: string;
  passCount: number;
  repairableCount: number;
  warningCount: number;
  errorCount: number;
  criticalCount: number;
  artifactCount: number;
}

export function createCandidateSelectionMetrics(
  candidateId: string,
  artifactCount: number,
): CandidateSelectionMetrics {
  return {
    candidateId,
    passCount: 0,
    repairableCount: 0,
    warningCount: 0,
    errorCount: 0,
    criticalCount: 0,
    artifactCount,
  };
}
