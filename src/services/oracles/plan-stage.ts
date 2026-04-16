import { type OracleVerdict, oracleVerdictSchema, witnessSchema } from "../../domain/oracle.js";
import type {
  CandidateScorecardStageResult,
  ConsultationPlanArtifact,
  ConsultationPlanStage,
  ConsultationPlanWorkstream,
} from "../../domain/run.js";
import { collectCandidateChangeInsight } from "../change-insights.js";
import {
  type EvaluateConsultationPlanStageOptions,
  type EvaluateConsultationPlanStageResult,
  hasWorkstreamCoverage,
  normalizeProjectRelativePath,
} from "./shared.js";

export async function evaluateConsultationPlanStage(
  options: EvaluateConsultationPlanStageOptions,
): Promise<EvaluateConsultationPlanStageResult> {
  const stageRoundId = resolveConsultationPlanStageRoundId(options.stage);
  const stageWorkstreams = resolveStageWorkstreams(
    options.consultationPlan.workstreams,
    options.stage.workstreamIds,
  );
  const changeInsight = await collectCandidateChangeInsight(options.candidate, {
    rules: options.projectConfig.managedTree,
  });
  const changedPaths = changeInsight.changedPaths.map(normalizeProjectRelativePath);
  const passedOracleIds = new Set(
    options.existingVerdicts
      .filter((verdict) => verdict.status === "pass")
      .map((verdict) => verdict.oracleId),
  );
  const coveredWorkstreamIds = getCoveredWorkstreamIds(options.completedStageResults);
  const orderedWorkstreams = topologicallySortStageWorkstreams(stageWorkstreams);
  const workstreamCoverage: Record<string, "blocked" | "covered" | "missing"> = {};
  const missingCoverageMessages: string[] = [];
  const dependencyMessages: string[] = [];
  const collateralMessages: string[] = [];
  const missingOracleMessages: string[] = [];
  const unresolvedRisks = new Set<string>();

  for (const workstream of orderedWorkstreams) {
    const normalizedProtectedPaths = workstream.protectedPaths.map(normalizeProjectRelativePath);
    const touchedProtectedPaths = changedPaths.filter((targetPath) =>
      normalizedProtectedPaths.includes(targetPath),
    );
    if (touchedProtectedPaths.length > 0) {
      collateralMessages.push(
        `Workstream "${workstream.id}" changed protected paths: ${touchedProtectedPaths.join(", ")}.`,
      );
      for (const risk of workstream.risks) {
        unresolvedRisks.add(risk);
      }
    }

    const missingDependencies = workstream.dependencies.filter(
      (dependencyId) => !coveredWorkstreamIds.has(dependencyId),
    );
    if (missingDependencies.length > 0) {
      workstreamCoverage[workstream.id] = "blocked";
      dependencyMessages.push(
        `Workstream "${workstream.id}" is blocked by uncovered dependencies: ${missingDependencies.join(", ")}.`,
      );
      for (const risk of workstream.risks) {
        unresolvedRisks.add(risk);
      }
      continue;
    }

    const missingRequiredOracles = workstream.oracleIds.filter(
      (oracleId) => !passedOracleIds.has(oracleId),
    );
    if (missingRequiredOracles.length > 0) {
      missingOracleMessages.push(
        `Workstream "${workstream.id}" is missing required passing oracles: ${missingRequiredOracles.join(", ")}.`,
      );
      for (const risk of workstream.risks) {
        unresolvedRisks.add(risk);
      }
    }

    if (hasWorkstreamCoverage(workstream, changedPaths)) {
      workstreamCoverage[workstream.id] = "covered";
      coveredWorkstreamIds.add(workstream.id);
      continue;
    }

    workstreamCoverage[workstream.id] = "missing";
    missingCoverageMessages.push(
      `Workstream "${workstream.id}" did not achieve required target coverage.`,
    );
    for (const risk of workstream.risks) {
      unresolvedRisks.add(risk);
    }
  }

  const missingCoverageCodes = buildMissingCoveragePolicyCodes(workstreamCoverage);
  const dependencyCodes = dependencyMessages.length > 0 ? ["integration-contradiction"] : [];
  const collateralCodes =
    collateralMessages.length > 0 ? ["protected-path-violation", "forbidden-collateral-path"] : [];
  const missingOracleCodes = missingOracleMessages.length > 0 ? ["missing-required-oracle"] : [];
  const stageViolationCodes = [
    ...missingCoverageCodes,
    ...dependencyCodes,
    ...collateralCodes,
    ...missingOracleCodes,
  ];
  const stageStatus = resolvePlanPolicyStatus(options.consultationPlan, stageViolationCodes);
  const safeStageId = toSafeIdentifierSegment(options.stage.id);

  const targetCoverageWitness = witnessSchema.parse({
    id: `${options.candidate.id}-planned-workstream-target-coverage-${safeStageId}`,
    kind: "policy",
    title: `Planned workstream target coverage (${options.stage.label})`,
    detail:
      missingCoverageMessages.length === 0
        ? `All workstreams in stage "${options.stage.id}" achieved target coverage.`
        : missingCoverageMessages.join(" "),
    ...(changeInsight.changedPaths.length > 0
      ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
      : {}),
    scope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
  });
  const dependencyWitness = witnessSchema.parse({
    id: `${options.candidate.id}-planned-workstream-dependency-discipline-${safeStageId}`,
    kind: "policy",
    title: `Planned workstream dependency discipline (${options.stage.label})`,
    detail:
      dependencyMessages.length === 0
        ? `Stage "${options.stage.id}" respected all workstream dependencies.`
        : dependencyMessages.join(" "),
    scope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
  });
  const collateralWitness = witnessSchema.parse({
    id: `${options.candidate.id}-planned-forbidden-collateral-paths-${safeStageId}`,
    kind: "policy",
    title: `Planned forbidden collateral paths (${options.stage.label})`,
    detail:
      collateralMessages.length === 0
        ? `Stage "${options.stage.id}" respected all protected paths.`
        : collateralMessages.join(" "),
    ...(changeInsight.changedPaths.length > 0
      ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
      : {}),
    scope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
  });
  const exitWitness = witnessSchema.parse({
    id: `${options.candidate.id}-planned-stage-exit-criteria-${safeStageId}`,
    kind: "policy",
    title: `Planned stage exit criteria (${options.stage.label})`,
    detail:
      stageViolationCodes.length === 0
        ? `Stage "${options.stage.id}" satisfied its exit criteria.`
        : [
            ...missingCoverageMessages,
            ...dependencyMessages,
            ...collateralMessages,
            ...missingOracleMessages,
          ].join(" "),
    scope: [options.candidate.id, options.stage.id],
  });

  const targetCoverageStatus = resolvePlanPolicyStatus(
    options.consultationPlan,
    missingCoverageCodes,
  );
  const dependencyStatus = resolvePlanPolicyStatus(options.consultationPlan, dependencyCodes);
  const collateralStatus = resolvePlanPolicyStatus(options.consultationPlan, collateralCodes);

  const verdicts = [
    oracleVerdictSchema.parse({
      oracleId: `planned-workstream-target-coverage-${safeStageId}`,
      roundId: stageRoundId,
      status: targetCoverageStatus,
      severity: mapPlanPolicySeverity(targetCoverageStatus),
      summary:
        missingCoverageMessages.length === 0
          ? `All workstreams in stage "${options.stage.id}" achieved target coverage.`
          : missingCoverageMessages.join(" "),
      invariant:
        "Complex planned consultations must cover every required workstream target before finalist selection.",
      confidence: "high",
      ...(targetCoverageStatus === "pass"
        ? {}
        : {
            repairHint:
              "Cover every required workstream target, or refresh the consultation plan if the workstream graph changed.",
          }),
      affectedScope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [targetCoverageWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-workstream-dependency-discipline-${safeStageId}`,
      roundId: stageRoundId,
      status: dependencyStatus,
      severity: mapPlanPolicySeverity(dependencyStatus),
      summary:
        dependencyMessages.length === 0
          ? `Stage "${options.stage.id}" respected all workstream dependencies.`
          : dependencyMessages.join(" "),
      invariant:
        "Complex planned consultations must satisfy declared workstream dependencies before later stages proceed.",
      confidence: "high",
      ...(dependencyStatus === "pass"
        ? {}
        : {
            repairHint:
              "Resolve the missing dependency coverage, or refresh the consultation plan if the dependency graph changed.",
          }),
      affectedScope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [dependencyWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-forbidden-collateral-paths-${safeStageId}`,
      roundId: stageRoundId,
      status: collateralStatus,
      severity: mapPlanPolicySeverity(collateralStatus),
      summary:
        collateralMessages.length === 0
          ? `Stage "${options.stage.id}" respected all protected workstream paths.`
          : collateralMessages.join(" "),
      invariant:
        "Complex planned consultations must not introduce forbidden collateral changes inside protected workstream paths.",
      confidence: "high",
      ...(collateralStatus === "pass"
        ? {}
        : {
            repairHint:
              "Revert the forbidden collateral changes, or refresh the consultation plan if those paths must now change.",
          }),
      affectedScope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [collateralWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-stage-exit-criteria-${safeStageId}`,
      roundId: stageRoundId,
      status: stageStatus,
      severity: mapPlanPolicySeverity(stageStatus),
      summary:
        stageViolationCodes.length === 0
          ? `Stage "${options.stage.id}" satisfied its exit criteria.`
          : [
              ...missingCoverageMessages,
              ...dependencyMessages,
              ...collateralMessages,
              ...missingOracleMessages,
            ].join(" "),
      invariant:
        "Complex planned consultations must satisfy stage exit criteria before surviving to later stages or finalist comparison.",
      confidence: "high",
      ...(stageStatus === "pass"
        ? {}
        : {
            repairHint:
              "Satisfy the stage exit criteria, or refresh the consultation plan if the staged execution graph changed.",
          }),
      affectedScope: [options.candidate.id, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [exitWitness],
    }),
  ];

  return {
    roundId: stageRoundId,
    stageResult: {
      stageId: options.stage.id,
      status: stageStatus,
      workstreamCoverage,
      violations: [
        ...missingCoverageMessages,
        ...dependencyMessages,
        ...collateralMessages,
        ...missingOracleMessages,
      ],
      unresolvedRisks: [...unresolvedRisks],
    },
    verdicts,
    witnesses: [targetCoverageWitness, dependencyWitness, collateralWitness, exitWitness],
  };
}

function resolveStageWorkstreams(
  workstreams: ConsultationPlanArtifact["workstreams"],
  workstreamIds: string[],
): ConsultationPlanWorkstream[] {
  const workstreamsById = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  return workstreamIds
    .map((workstreamId) => workstreamsById.get(workstreamId))
    .filter((workstream): workstream is ConsultationPlanWorkstream => workstream !== undefined);
}

function resolveConsultationPlanStageRoundId(stage: ConsultationPlanStage) {
  const plannedRoundId = stage.roundIds[stage.roundIds.length - 1];
  return plannedRoundId ?? "fast";
}

function getCoveredWorkstreamIds(stageResults: CandidateScorecardStageResult[]): Set<string> {
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

function topologicallySortStageWorkstreams(
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

function buildMissingCoveragePolicyCodes(
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

function resolvePlanPolicyStatus(
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

function mapPlanPolicySeverity(status: OracleVerdict["status"]): OracleVerdict["severity"] {
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

function toSafeIdentifierSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-");
  const compact = normalized.replace(/-+/gu, "-").replace(/^-|-$/gu, "");
  return compact.length > 0 ? compact : "stage";
}
