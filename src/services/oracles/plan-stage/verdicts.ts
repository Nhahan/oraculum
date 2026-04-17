import { type OracleVerdict, oracleVerdictSchema, witnessSchema } from "../../../domain/oracle.js";
import type { ConsultationPlanArtifact, ConsultationPlanStage } from "../../../domain/run.js";

import {
  mapPlanPolicySeverity,
  resolvePlanPolicyStatus,
  toSafeIdentifierSegment,
} from "./policy.js";

interface BuildPlanStageVerdictsOptions {
  candidateId: string;
  changedPaths: string[];
  collateralCodes: string[];
  collateralMessages: string[];
  consultationPlan: ConsultationPlanArtifact;
  dependencyCodes: string[];
  dependencyMessages: string[];
  missingCoverageCodes: string[];
  missingCoverageMessages: string[];
  missingOracleCodes: string[];
  missingOracleMessages: string[];
  stage: ConsultationPlanStage;
  stageRoundId: string;
  stageViolationCodes: string[];
}

export function buildPlanStageVerdicts(options: BuildPlanStageVerdictsOptions): {
  stageStatus: OracleVerdict["status"];
  verdicts: OracleVerdict[];
  witnesses: ReturnType<typeof witnessSchema.parse>[];
} {
  const safeStageId = toSafeIdentifierSegment(options.stage.id);
  const stageStatus = resolvePlanPolicyStatus(
    options.consultationPlan,
    options.stageViolationCodes,
  );
  const targetCoverageStatus = resolvePlanPolicyStatus(
    options.consultationPlan,
    options.missingCoverageCodes,
  );
  const dependencyStatus = resolvePlanPolicyStatus(
    options.consultationPlan,
    options.dependencyCodes,
  );
  const collateralStatus = resolvePlanPolicyStatus(
    options.consultationPlan,
    options.collateralCodes,
  );

  const targetCoverageWitness = witnessSchema.parse({
    id: `${options.candidateId}-planned-workstream-target-coverage-${safeStageId}`,
    kind: "policy",
    title: `Planned workstream target coverage (${options.stage.label})`,
    detail:
      options.missingCoverageMessages.length === 0
        ? `All workstreams in stage "${options.stage.id}" achieved target coverage.`
        : options.missingCoverageMessages.join(" "),
    ...(options.changedPaths.length > 0
      ? { excerpt: options.changedPaths.slice(0, 8).join(", ") }
      : {}),
    scope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
  });
  const dependencyWitness = witnessSchema.parse({
    id: `${options.candidateId}-planned-workstream-dependency-discipline-${safeStageId}`,
    kind: "policy",
    title: `Planned workstream dependency discipline (${options.stage.label})`,
    detail:
      options.dependencyMessages.length === 0
        ? `Stage "${options.stage.id}" respected all workstream dependencies.`
        : options.dependencyMessages.join(" "),
    scope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
  });
  const collateralWitness = witnessSchema.parse({
    id: `${options.candidateId}-planned-forbidden-collateral-paths-${safeStageId}`,
    kind: "policy",
    title: `Planned forbidden collateral paths (${options.stage.label})`,
    detail:
      options.collateralMessages.length === 0
        ? `Stage "${options.stage.id}" respected all protected paths.`
        : options.collateralMessages.join(" "),
    ...(options.changedPaths.length > 0
      ? { excerpt: options.changedPaths.slice(0, 8).join(", ") }
      : {}),
    scope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
  });
  const exitWitness = witnessSchema.parse({
    id: `${options.candidateId}-planned-stage-exit-criteria-${safeStageId}`,
    kind: "policy",
    title: `Planned stage exit criteria (${options.stage.label})`,
    detail:
      options.stageViolationCodes.length === 0
        ? `Stage "${options.stage.id}" satisfied its exit criteria.`
        : [
            ...options.missingCoverageMessages,
            ...options.dependencyMessages,
            ...options.collateralMessages,
            ...options.missingOracleMessages,
          ].join(" "),
    scope: [options.candidateId, options.stage.id],
  });

  const verdicts = [
    oracleVerdictSchema.parse({
      oracleId: `planned-workstream-target-coverage-${safeStageId}`,
      roundId: options.stageRoundId,
      status: targetCoverageStatus,
      severity: mapPlanPolicySeverity(targetCoverageStatus),
      summary:
        options.missingCoverageMessages.length === 0
          ? `All workstreams in stage "${options.stage.id}" achieved target coverage.`
          : options.missingCoverageMessages.join(" "),
      invariant:
        "Complex planned consultations must cover every required workstream target before finalist selection.",
      confidence: "high",
      ...(targetCoverageStatus === "pass"
        ? {}
        : {
            repairHint:
              "Cover every required workstream target, or refresh the consultation plan if the workstream graph changed.",
          }),
      affectedScope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [targetCoverageWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-workstream-dependency-discipline-${safeStageId}`,
      roundId: options.stageRoundId,
      status: dependencyStatus,
      severity: mapPlanPolicySeverity(dependencyStatus),
      summary:
        options.dependencyMessages.length === 0
          ? `Stage "${options.stage.id}" respected all workstream dependencies.`
          : options.dependencyMessages.join(" "),
      invariant:
        "Complex planned consultations must satisfy declared workstream dependencies before later stages proceed.",
      confidence: "high",
      ...(dependencyStatus === "pass"
        ? {}
        : {
            repairHint:
              "Resolve the missing dependency coverage, or refresh the consultation plan if the dependency graph changed.",
          }),
      affectedScope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [dependencyWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-forbidden-collateral-paths-${safeStageId}`,
      roundId: options.stageRoundId,
      status: collateralStatus,
      severity: mapPlanPolicySeverity(collateralStatus),
      summary:
        options.collateralMessages.length === 0
          ? `Stage "${options.stage.id}" respected all protected workstream paths.`
          : options.collateralMessages.join(" "),
      invariant:
        "Complex planned consultations must not introduce forbidden collateral changes inside protected workstream paths.",
      confidence: "high",
      ...(collateralStatus === "pass"
        ? {}
        : {
            repairHint:
              "Revert the forbidden collateral changes, or refresh the consultation plan if those paths must now change.",
          }),
      affectedScope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [collateralWitness],
    }),
    oracleVerdictSchema.parse({
      oracleId: `planned-stage-exit-criteria-${safeStageId}`,
      roundId: options.stageRoundId,
      status: stageStatus,
      severity: mapPlanPolicySeverity(stageStatus),
      summary:
        options.stageViolationCodes.length === 0
          ? `Stage "${options.stage.id}" satisfied its exit criteria.`
          : [
              ...options.missingCoverageMessages,
              ...options.dependencyMessages,
              ...options.collateralMessages,
              ...options.missingOracleMessages,
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
      affectedScope: [options.candidateId, options.stage.id, ...options.stage.workstreamIds],
      witnesses: [exitWitness],
    }),
  ];

  return {
    stageStatus,
    verdicts,
    witnesses: [targetCoverageWitness, dependencyWitness, collateralWitness, exitWitness],
  };
}
