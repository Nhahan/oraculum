import { OraculumError } from "../../../core/errors.js";
import type { ProjectConfig } from "../../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";

export function resolveConsultationPlanRounds(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
): ProjectConfig["rounds"] {
  if (consultationPlan.roundOrder.length === 0) {
    return config.rounds;
  }

  const roundsById = new Map(config.rounds.map((round) => [round.id, round]));
  const seen = new Set<string>();
  const rounds: ProjectConfig["rounds"] = [];

  for (const plannedRound of consultationPlan.roundOrder) {
    if (seen.has(plannedRound.id)) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" repeats round "${plannedRound.id}". Refresh the plan and rerun.`,
      );
    }
    seen.add(plannedRound.id);

    const round = roundsById.get(plannedRound.id);
    if (!round) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references round "${plannedRound.id}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }
    rounds.push(round);
  }

  return rounds;
}
