import { OraculumError } from "../../../core/errors.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";

export function resolveConsultationPlanCandidateCount(
  consultationPlan: ConsultationPlanArtifact,
  requestedCandidateCount: number | undefined,
): number {
  if (consultationPlan.candidateCount < 1) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" is not ready for execution because it does not bind any candidates.`,
    );
  }

  if (
    requestedCandidateCount !== undefined &&
    requestedCandidateCount !== consultationPlan.candidateCount
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" binds candidateCount=${consultationPlan.candidateCount}; rerun the plan after changing candidate-count config instead of overriding it to ${requestedCandidateCount}.`,
    );
  }

  return consultationPlan.candidateCount;
}
