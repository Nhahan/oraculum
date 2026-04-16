import { OraculumError } from "../../core/errors.js";
import type { ProjectConfig, Strategy } from "../../domain/config.js";

export function selectStrategies(config: ProjectConfig, candidateCount: number): Strategy[] {
  return Array.from({ length: candidateCount }, (_, index) => {
    const strategy = config.strategies[index % config.strategies.length];
    if (!strategy) {
      throw new OraculumError("No candidate strategies are configured.");
    }

    if (index < config.strategies.length) {
      return strategy;
    }

    return {
      ...strategy,
      id: `${strategy.id}-${index + 1}`,
      label: `${strategy.label} ${index + 1}`,
    };
  });
}
