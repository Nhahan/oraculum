import { OraculumError } from "../../../core/errors.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";

export function assertConsultationPlanProfileSelectionConsistency(
  consultationPlan: ConsultationPlanArtifact,
  options: {
    candidateCount: number;
    oracleIds: string[];
    strategyIds: string[];
  },
): void {
  if (!consultationPlan.profileSelection) {
    return;
  }

  if (consultationPlan.profileSelection.candidateCount !== options.candidateCount) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent profileSelection.candidateCount (${consultationPlan.profileSelection.candidateCount}) for candidateCount=${options.candidateCount}. Refresh the plan and rerun.`,
    );
  }

  if (
    consultationPlan.profileSelection.oracleIds.length > 0 &&
    !stringArraysEqual(consultationPlan.profileSelection.oracleIds, options.oracleIds)
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent oracle preset metadata. Refresh the plan and rerun.`,
    );
  }

  if (
    consultationPlan.profileSelection.strategyIds.length > 0 &&
    !stringArraysEqual(consultationPlan.profileSelection.strategyIds, options.strategyIds)
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent strategy preset metadata. Refresh the plan and rerun.`,
    );
  }
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
