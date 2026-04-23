import { OraculumError } from "../../../core/errors.js";
import type { ProjectConfig } from "../../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";

export function assertConsultationPlanExecutionGraphConsistency(
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
