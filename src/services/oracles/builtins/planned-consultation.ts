import { oracleVerdictSchema, witnessSchema } from "../../../domain/oracle.js";
import { collectCandidateChangeInsight } from "../../change-insights.js";
import {
  type EvaluateCandidateRoundOptions,
  normalizeProjectRelativePath,
  type OracleDefinition,
} from "../shared.js";

const plannedTargetArtifactOracle: OracleDefinition = {
  oracleId: "planned-target-artifact",
  roundId: "fast",
  async evaluate(options) {
    const changeInsight = await collectCandidateChangeInsight(options.candidate, {
      rules: options.projectConfig.managedTree,
    });
    const plannedTargetPath = normalizeProjectRelativePath(
      options.taskPacket.targetArtifactPath ?? "",
    );
    const changedPaths = changeInsight.changedPaths.map(normalizeProjectRelativePath);
    const touchedTargetPath =
      plannedTargetPath.length > 0 && changedPaths.includes(plannedTargetPath);
    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-planned-target-artifact`,
      kind: "policy",
      title: "Planned target artifact coverage",
      detail: touchedTargetPath
        ? `Candidate changed the planned target artifact path "${plannedTargetPath}".`
        : `Candidate did not change the planned target artifact path "${plannedTargetPath}".`,
      ...(changeInsight.changedPaths.length > 0
        ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
        : {}),
      scope: [options.candidate.id, plannedTargetPath],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: "planned-target-artifact",
        roundId: "fast",
        status: touchedTargetPath ? "pass" : "repairable",
        severity: touchedTargetPath ? "info" : "warning",
        summary: touchedTargetPath
          ? `Candidate touched the planned target artifact "${plannedTargetPath}".`
          : `Candidate did not touch the planned target artifact "${plannedTargetPath}".`,
        invariant: "Planned consultations must materially change their declared target artifact.",
        confidence: "high",
        ...(touchedTargetPath
          ? {}
          : {
              repairHint:
                "Update the planned target artifact in the workspace, or refresh the consultation plan if the intended target changed.",
            }),
        affectedScope: [options.candidate.id, plannedTargetPath],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  },
};

const plannedRequiredChangedPathsOracle: OracleDefinition = {
  oracleId: "planned-required-changed-paths",
  roundId: "fast",
  async evaluate(options) {
    const requiredChangedPaths = options.consultationPlan?.requiredChangedPaths ?? [];
    const normalizedRequiredPaths = requiredChangedPaths.map(normalizeProjectRelativePath);
    const changeInsight = await collectCandidateChangeInsight(options.candidate, {
      rules: options.projectConfig.managedTree,
    });
    const changedPaths = changeInsight.changedPaths.map(normalizeProjectRelativePath);
    const missingRequiredPaths = normalizedRequiredPaths.filter(
      (targetPath) => !changedPaths.includes(targetPath),
    );
    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-planned-required-changed-paths`,
      kind: "policy",
      title: "Planned required-path coverage",
      detail:
        missingRequiredPaths.length === 0
          ? "Candidate changed every required path from the consultation plan."
          : `Candidate did not change required paths from the consultation plan: ${missingRequiredPaths.join(", ")}.`,
      ...(changeInsight.changedPaths.length > 0
        ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
        : {}),
      scope: [options.candidate.id, ...normalizedRequiredPaths],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: "planned-required-changed-paths",
        roundId: "fast",
        status: missingRequiredPaths.length === 0 ? "pass" : "repairable",
        severity: missingRequiredPaths.length === 0 ? "info" : "warning",
        summary:
          missingRequiredPaths.length === 0
            ? "Candidate changed every required path recorded in the consultation plan."
            : `Candidate did not change required paths from the consultation plan: ${missingRequiredPaths.join(", ")}.`,
        invariant:
          "Planned consultations must materially change every required path unless the plan is refreshed.",
        confidence: "high",
        ...(missingRequiredPaths.length === 0
          ? {}
          : {
              repairHint:
                "Update every required path in the workspace, or refresh the consultation plan if the required change set has changed.",
            }),
        affectedScope: [options.candidate.id, ...normalizedRequiredPaths],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  },
};

const plannedProtectedPathsOracle: OracleDefinition = {
  oracleId: "planned-protected-paths",
  roundId: "fast",
  async evaluate(options) {
    const protectedPaths = options.consultationPlan?.protectedPaths ?? [];
    const normalizedProtectedPaths = protectedPaths.map(normalizeProjectRelativePath);
    const changeInsight = await collectCandidateChangeInsight(options.candidate, {
      rules: options.projectConfig.managedTree,
    });
    const touchedProtectedPaths = changeInsight.changedPaths
      .map(normalizeProjectRelativePath)
      .filter((targetPath) => normalizedProtectedPaths.includes(targetPath));
    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-planned-protected-paths`,
      kind: "policy",
      title: "Planned protected path coverage",
      detail:
        touchedProtectedPaths.length === 0
          ? "Candidate respected all protected paths from the consultation plan."
          : `Candidate changed protected paths from the consultation plan: ${touchedProtectedPaths.join(", ")}.`,
      ...(changeInsight.changedPaths.length > 0
        ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
        : {}),
      scope: [options.candidate.id, ...normalizedProtectedPaths],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: "planned-protected-paths",
        roundId: "fast",
        status: touchedProtectedPaths.length === 0 ? "pass" : "repairable",
        severity: touchedProtectedPaths.length === 0 ? "info" : "warning",
        summary:
          touchedProtectedPaths.length === 0
            ? "Candidate respected the protected paths recorded in the consultation plan."
            : `Candidate changed protected paths from the consultation plan: ${touchedProtectedPaths.join(", ")}.`,
        invariant:
          "Planned consultations must not modify protected paths unless the plan is refreshed.",
        confidence: "high",
        ...(touchedProtectedPaths.length === 0
          ? {}
          : {
              repairHint:
                "Revert the protected-path changes, or refresh the consultation plan if those paths must now change.",
            }),
        affectedScope: [options.candidate.id, ...normalizedProtectedPaths],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  },
};

export function getSelectedPlannedConsultationOracles(
  options: EvaluateCandidateRoundOptions,
): OracleDefinition[] {
  const selected: OracleDefinition[] = [];
  const hasRequiredChangedPaths = (options.consultationPlan?.requiredChangedPaths.length ?? 0) > 0;

  if (
    options.roundId === plannedTargetArtifactOracle.roundId &&
    options.result.status === "completed" &&
    options.taskPacket.source.kind === "consultation-plan" &&
    !hasRequiredChangedPaths &&
    options.taskPacket.targetArtifactPath
  ) {
    selected.push(plannedTargetArtifactOracle);
  }

  if (
    options.roundId === plannedRequiredChangedPathsOracle.roundId &&
    options.result.status === "completed" &&
    options.taskPacket.source.kind === "consultation-plan" &&
    hasRequiredChangedPaths
  ) {
    selected.push(plannedRequiredChangedPathsOracle);
  }

  if (
    options.roundId === plannedProtectedPathsOracle.roundId &&
    options.result.status === "completed" &&
    options.taskPacket.source.kind === "consultation-plan" &&
    (options.consultationPlan?.protectedPaths.length ?? 0) > 0
  ) {
    selected.push(plannedProtectedPathsOracle);
  }

  return selected;
}
