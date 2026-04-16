import { OraculumError } from "../../core/errors.js";
import { type ProjectConfig, projectConfigSchema, type Strategy } from "../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../domain/run.js";
import { selectStrategies } from "./strategy-selection.js";

export function applyConsultationPlanPreset(options: {
  baseConfig: ProjectConfig;
  consultationPlan: ConsultationPlanArtifact;
  requestedCandidateCount?: number;
}): ProjectConfig {
  const candidateCount = resolveConsultationPlanCandidateCount(
    options.consultationPlan,
    options.requestedCandidateCount,
  );
  const rounds = resolveConsultationPlanRounds(options.baseConfig, options.consultationPlan);
  const strategies = resolveConsultationPlanStrategies(
    options.baseConfig,
    options.consultationPlan,
    candidateCount,
  );
  const oracles = resolveConsultationPlanOracles(
    options.baseConfig,
    options.consultationPlan,
    rounds,
  );

  assertConsultationPlanProfileSelectionConsistency(options.consultationPlan, {
    candidateCount,
    oracleIds: oracles.map((oracle) => oracle.id),
    strategyIds: strategies.map((strategy) => strategy.id),
  });
  assertConsultationPlanExecutionGraphConsistency(options.consultationPlan, {
    availableOracleIds: options.baseConfig.oracles.map((oracle) => oracle.id),
    roundIds: rounds.map((round) => round.id),
  });

  return projectConfigSchema.parse({
    ...options.baseConfig,
    defaultCandidates: candidateCount,
    strategies,
    rounds,
    oracles,
  });
}

function resolveConsultationPlanCandidateCount(
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
      `Persisted consultation plan "${consultationPlan.runId}" binds candidateCount=${consultationPlan.candidateCount}; rerun the plan instead of overriding --candidates to ${requestedCandidateCount}.`,
    );
  }

  return consultationPlan.candidateCount;
}

function resolveConsultationPlanRounds(
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

function resolveConsultationPlanStrategies(
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

function resolveConsultationPlanOracles(
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

function assertConsultationPlanProfileSelectionConsistency(
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

function assertConsultationPlanExecutionGraphConsistency(
  consultationPlan: ConsultationPlanArtifact,
  options: {
    availableOracleIds: string[];
    roundIds: ProjectConfig["rounds"][number]["id"][];
  },
): void {
  assertUniqueExecutionGraphIds(
    consultationPlan.workstreams.map((workstream) => workstream.id),
    {
      itemKind: "workstream",
      runId: consultationPlan.runId,
    },
  );
  assertUniqueExecutionGraphIds(
    consultationPlan.stagePlan.map((stage) => stage.id),
    {
      itemKind: "stage",
      runId: consultationPlan.runId,
    },
  );

  const workstreamIds = new Set(consultationPlan.workstreams.map((workstream) => workstream.id));
  const stageIds = new Set(consultationPlan.stagePlan.map((stage) => stage.id));
  const availableOracleIds = new Set(options.availableOracleIds);
  const roundIds = new Set(options.roundIds);

  for (const workstream of consultationPlan.workstreams) {
    for (const dependencyId of workstream.dependencies) {
      if (!workstreamIds.has(dependencyId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown workstream dependency "${dependencyId}" from "${workstream.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const oracleId of workstream.oracleIds) {
      if (!availableOracleIds.has(oracleId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references workstream oracle "${oracleId}" that is not available in the current project config. Refresh the plan and rerun.`,
        );
      }
    }
  }

  for (const stage of consultationPlan.stagePlan) {
    for (const dependencyId of stage.dependsOn) {
      if (!stageIds.has(dependencyId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown stage dependency "${dependencyId}" from "${stage.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const workstreamId of stage.workstreamIds) {
      if (!workstreamIds.has(workstreamId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown workstream "${workstreamId}" from stage "${stage.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const roundId of stage.roundIds) {
      if (!roundIds.has(roundId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references stage round "${roundId}" that is not available in the current project config. Refresh the plan and rerun.`,
        );
      }
    }
  }

  assertExecutionGraphAcyclic({
    dependencyKind: "workstream",
    edges: consultationPlan.workstreams.map((workstream) => ({
      id: workstream.id,
      dependsOn: workstream.dependencies,
    })),
    runId: consultationPlan.runId,
  });
  assertExecutionGraphAcyclic({
    dependencyKind: "stage",
    edges: consultationPlan.stagePlan.map((stage) => ({
      id: stage.id,
      dependsOn: stage.dependsOn,
    })),
    runId: consultationPlan.runId,
  });
}

function assertUniqueExecutionGraphIds(
  ids: string[],
  options: {
    itemKind: "stage" | "workstream";
    runId: string;
  },
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new OraculumError(
        `Persisted consultation plan "${options.runId}" repeats ${options.itemKind} "${id}". Refresh the plan and rerun.`,
      );
    }
    seen.add(id);
  }
}

function assertExecutionGraphAcyclic(options: {
  dependencyKind: "stage" | "workstream";
  edges: Array<{ id: string; dependsOn: string[] }>;
  runId: string;
}): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const edgesById = new Map(options.edges.map((edge) => [edge.id, edge.dependsOn]));

  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new OraculumError(
        `Persisted consultation plan "${options.runId}" contains a ${options.dependencyKind} dependency cycle through "${id}". Refresh the plan and rerun.`,
      );
    }

    visiting.add(id);
    for (const dependencyId of edgesById.get(id) ?? []) {
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const edge of options.edges) {
    visit(edge.id);
  }
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
