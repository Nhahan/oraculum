import type { ConsultationPlanArtifact } from "../../../domain/run.js";
import { collectCandidateChangeInsight } from "../../change-insights.js";
import {
  type EvaluateConsultationPlanStageOptions,
  type EvaluateConsultationPlanStageResult,
  hasWorkstreamCoverage,
  normalizeProjectRelativePath,
} from "../shared.js";
import {
  buildMissingCoveragePolicyCodes,
  getCoveredWorkstreamIds,
  resolveConsultationPlanStageRoundId,
  resolveStageWorkstreams,
  topologicallySortStageWorkstreams,
} from "./policy.js";
import { buildPlanStageVerdicts } from "./verdicts.js";

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
    applyProtectedPathChecks(workstream, changedPaths, collateralMessages, unresolvedRisks);

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

  const { stageStatus, verdicts, witnesses } = buildPlanStageVerdicts({
    candidateId: options.candidate.id,
    changedPaths: changeInsight.changedPaths,
    collateralCodes,
    collateralMessages,
    consultationPlan: options.consultationPlan as ConsultationPlanArtifact,
    dependencyCodes,
    dependencyMessages,
    missingCoverageCodes,
    missingCoverageMessages,
    missingOracleCodes,
    missingOracleMessages,
    stage: options.stage,
    stageRoundId,
    stageViolationCodes,
  });

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
    witnesses,
  };
}

function applyProtectedPathChecks(
  workstream: ConsultationPlanArtifact["workstreams"][number],
  changedPaths: string[],
  collateralMessages: string[],
  unresolvedRisks: Set<string>,
) {
  const normalizedProtectedPaths = workstream.protectedPaths.map(normalizeProjectRelativePath);
  const touchedProtectedPaths = changedPaths.filter((targetPath) =>
    normalizedProtectedPaths.includes(targetPath),
  );
  if (touchedProtectedPaths.length === 0) {
    return;
  }

  collateralMessages.push(
    `Workstream "${workstream.id}" changed protected paths: ${touchedProtectedPaths.join(", ")}.`,
  );
  for (const risk of workstream.risks) {
    unresolvedRisks.add(risk);
  }
}
