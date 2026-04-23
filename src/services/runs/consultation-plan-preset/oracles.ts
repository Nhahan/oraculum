import { OraculumError } from "../../../core/errors.js";
import type { ProjectConfig } from "../../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";

export function resolveConsultationPlanOracles(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
  rounds: ProjectConfig["rounds"],
): ProjectConfig["oracles"] {
  const allowedRoundIds = new Set(rounds.map((round) => round.id));
  const selectedOracleIds =
    consultationPlan.oracleIds.length > 0
      ? consultationPlan.oracleIds
      : (consultationPlan.profileSelection?.oracleIds ?? []);

  if (selectedOracleIds.length === 0) {
    return config.oracles.filter((oracle) => allowedRoundIds.has(oracle.roundId));
  }

  const selected: ProjectConfig["oracles"] = [];
  const seen = new Set<string>();

  for (const oracleId of selectedOracleIds) {
    const matches = config.oracles.filter(
      (oracle) => oracle.id === oracleId && allowedRoundIds.has(oracle.roundId),
    );
    if (matches.length === 0) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references oracle "${oracleId}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }

    for (const oracle of matches) {
      const key = `${oracle.roundId}:${oracle.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      selected.push(oracle);
    }
  }

  return selected;
}
