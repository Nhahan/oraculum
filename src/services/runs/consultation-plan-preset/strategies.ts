import { OraculumError } from "../../../core/errors.js";
import type { ProjectConfig, Strategy } from "../../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";
import { selectStrategies } from "../strategy-selection.js";

export function resolveConsultationPlanStrategies(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
  candidateCount: number,
): Strategy[] {
  if (consultationPlan.plannedStrategies.length > 0) {
    if (consultationPlan.plannedStrategies.length !== candidateCount) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" records ${consultationPlan.plannedStrategies.length} planned strategies but candidateCount=${candidateCount}. Refresh the plan and rerun.`,
      );
    }

    return consultationPlan.plannedStrategies.map((strategy) => {
      const existing = config.strategies.find((candidate) => candidate.id === strategy.id);
      return {
        id: strategy.id,
        label: strategy.label,
        description: existing?.description ?? `Planned consultation strategy: ${strategy.label}.`,
      };
    });
  }

  const plannedStrategyIds = consultationPlan.profileSelection?.strategyIds ?? [];
  if (plannedStrategyIds.length === 0) {
    return selectStrategies(config, candidateCount);
  }

  const strategiesById = new Map(config.strategies.map((strategy) => [strategy.id, strategy]));
  const strategies: Strategy[] = [];
  const seen = new Set<string>();

  for (const strategyId of plannedStrategyIds) {
    if (seen.has(strategyId)) {
      continue;
    }
    seen.add(strategyId);

    const strategy = strategiesById.get(strategyId);
    if (!strategy) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references strategy "${strategyId}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }
    strategies.push(strategy);
  }

  if (strategies.length === 0) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" did not resolve any executable strategies. Refresh the plan and rerun.`,
    );
  }

  return strategies;
}
