import type { OracleVerdict } from "../../../domain/oracle.js";
import type {
  CandidateScorecardStageResult,
  ConsultationPlanArtifact,
  ConsultationPlanStage,
  ConsultationPlanWorkstream,
} from "../../../domain/run.js";

export function resolveStageWorkstreams(
  workstreams: ConsultationPlanArtifact["workstreams"],
  workstreamIds: string[],
): ConsultationPlanWorkstream[] {
  const workstreamsById = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  return workstreamIds
    .map((workstreamId) => workstreamsById.get(workstreamId))
    .filter((workstream): workstream is ConsultationPlanWorkstream => workstream !== undefined);
}

export function resolveConsultationPlanStageRoundId(stage: ConsultationPlanStage) {
  const plannedRoundId = stage.roundIds[stage.roundIds.length - 1];
  return plannedRoundId ?? "fast";
}

export function getCoveredWorkstreamIds(
  stageResults: CandidateScorecardStageResult[],
): Set<string> {
  const covered = new Set<string>();
  for (const stageResult of stageResults) {
    for (const [workstreamId, status] of Object.entries(stageResult.workstreamCoverage)) {
      if (status === "covered") {
        covered.add(workstreamId);
      }
    }
  }
  return covered;
}

export function topologicallySortStageWorkstreams(
  workstreams: ConsultationPlanWorkstream[],
): ConsultationPlanWorkstream[] {
  const workstreamIds = new Set(workstreams.map((workstream) => workstream.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const workstreamsById = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  const ordered: ConsultationPlanWorkstream[] = [];

  const visit = (workstream: ConsultationPlanWorkstream): void => {
    if (visited.has(workstream.id) || visiting.has(workstream.id)) {
      return;
    }

    visiting.add(workstream.id);
    for (const dependencyId of workstream.dependencies) {
      if (!workstreamIds.has(dependencyId)) {
        continue;
      }
      const dependency = workstreamsById.get(dependencyId);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(workstream.id);
    visited.add(workstream.id);
    ordered.push(workstream);
  };

  for (const workstream of workstreams) {
    visit(workstream);
  }

  return ordered;
}

export function buildMissingCoveragePolicyCodes(
  workstreamCoverage: Record<string, "blocked" | "covered" | "missing">,
): string[] {
  const statuses = Object.values(workstreamCoverage);
  const missingCount = statuses.filter((status) => status === "missing").length;
  const coveredCount = statuses.filter((status) => status === "covered").length;

  if (missingCount === 0) {
    return [];
  }

  return coveredCount > 0 ? ["partial-workstream-coverage"] : ["missing-target-coverage"];
}

export function resolvePlanPolicyStatus(
  consultationPlan: ConsultationPlanArtifact,
  policyKeys: string[],
): OracleVerdict["status"] {
  if (policyKeys.length === 0) {
    return "pass";
  }

  const immediate = new Set(consultationPlan.repairPolicy.immediateElimination);
  const repairable = new Set(consultationPlan.repairPolicy.repairable);
  const abstain = new Set(consultationPlan.repairPolicy.preferAbstainOverRetry);

  if (policyKeys.some((policyKey) => immediate.has(policyKey) || abstain.has(policyKey))) {
    return "fail";
  }
  if (policyKeys.some((policyKey) => repairable.has(policyKey))) {
    return "repairable";
  }
  return "fail";
}

export function mapPlanPolicySeverity(status: OracleVerdict["status"]): OracleVerdict["severity"] {
  switch (status) {
    case "pass":
      return "info";
    case "repairable":
      return "warning";
    case "skip":
      return "warning";
    case "fail":
      return "error";
  }
}

export function toSafeIdentifierSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-");
  const compact = normalized.replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return compact.length > 0 ? compact : "stage";
}
