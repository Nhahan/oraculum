import { oracleVerdictSchema, witnessSchema } from "../../domain/oracle.js";
import { collectCandidateChangeInsight } from "../change-insights.js";
import {
  type EvaluateCandidateRoundOptions,
  normalizeProjectRelativePath,
  type OracleDefinition,
} from "./shared.js";

const builtInOracles: OracleDefinition[] = [
  {
    oracleId: "agent-exit",
    roundId: "fast",
    evaluate(options) {
      const exitWitness = witnessSchema.parse({
        id: `${options.candidate.id}-agent-exit`,
        kind: "log",
        title: "Agent process exit",
        detail: `Adapter status=${options.result.status}, exitCode=${options.result.exitCode}.`,
        scope: [options.candidate.id, options.candidate.strategyId],
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "agent-exit",
          roundId: "fast",
          status: options.result.status === "completed" ? "pass" : "fail",
          severity: options.result.status === "completed" ? "info" : "error",
          summary:
            options.result.status === "completed"
              ? "Agent completed without a process failure."
              : "Agent execution did not complete successfully.",
          invariant: "The host adapter must finish candidate execution successfully.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          witnesses: [exitWitness],
        }),
        witnesses: [exitWitness],
      };
    },
  },
  {
    oracleId: "artifact-capture",
    roundId: "fast",
    evaluate(options) {
      const hasMaterializedOutput = options.result.artifacts.some(
        (artifact) => artifact.kind !== "prompt" && artifact.kind !== "stderr",
      );
      const artifactWitness = witnessSchema.parse({
        id: `${options.candidate.id}-artifact-capture`,
        kind: "file",
        title: "Captured execution artifacts",
        detail: `Persisted ${options.result.artifacts.length} agent artifact(s).`,
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "artifact-capture",
          roundId: "fast",
          status: hasMaterializedOutput ? "pass" : "fail",
          severity: hasMaterializedOutput ? "info" : "warning",
          summary: hasMaterializedOutput
            ? "Execution produced persisted artifacts for later review."
            : "Execution did not leave enough artifacts for review.",
          invariant: "Each candidate run must persist inspectable execution artifacts.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedOutput
            ? undefined
            : "Capture stdout, transcripts, reports, or patches from the host runtime.",
          witnesses: [artifactWitness],
        }),
        witnesses: [artifactWitness],
      };
    },
  },
  {
    oracleId: "reviewable-output",
    roundId: "impact",
    evaluate(options) {
      const reviewableKinds = new Set(["stdout", "transcript", "report", "patch"]);
      const hasReviewableOutput = options.result.artifacts.some((artifact) =>
        reviewableKinds.has(artifact.kind),
      );
      const outputWitness = witnessSchema.parse({
        id: `${options.candidate.id}-reviewable-output`,
        kind: "file",
        title: "Reviewable output coverage",
        detail: hasReviewableOutput
          ? "Execution left reviewable output for comparison."
          : "Execution did not leave reviewable output for comparison.",
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "reviewable-output",
          roundId: "impact",
          status: hasReviewableOutput ? "pass" : "repairable",
          severity: hasReviewableOutput ? "info" : "warning",
          summary: hasReviewableOutput
            ? "Candidate left artifacts suitable for human or automated comparison."
            : "Candidate lacks reviewable output artifacts beyond prompt/stderr.",
          invariant: "Candidates should leave reviewable output for later comparison.",
          confidence: "medium",
          affectedScope: [options.candidate.id],
          repairHint: hasReviewableOutput
            ? undefined
            : "Persist stdout, transcript, report, or patch artifacts from the runtime.",
          witnesses: [outputWitness],
        }),
        witnesses: [outputWitness],
      };
    },
  },
  {
    oracleId: "materialized-patch",
    roundId: "impact",
    async evaluate(options) {
      const changeInsight = await collectCandidateChangeInsight(options.candidate, {
        rules: options.projectConfig.managedTree,
      });
      const hasMaterializedPatch = changeInsight.changeSummary.changedPathCount > 0;
      const changeWitness = witnessSchema.parse({
        id: `${options.candidate.id}-materialized-patch`,
        kind: "file",
        title: "Materialized workspace changes",
        detail: hasMaterializedPatch
          ? `Captured ${changeInsight.changeSummary.changedPathCount} changed path(s) in the candidate workspace.`
          : "The candidate left no materialized file changes in the workspace.",
        scope: [options.candidate.id],
        ...(changeInsight.changedPaths.length > 0
          ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
          : {}),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "materialized-patch",
          roundId: "impact",
          status: hasMaterializedPatch ? "pass" : "repairable",
          severity: hasMaterializedPatch ? "info" : "warning",
          summary: hasMaterializedPatch
            ? "Candidate left materialized file changes in the workspace."
            : "Candidate described a patch but did not leave materialized file changes.",
          invariant: "Each surviving candidate must leave a materialized patch in its workspace.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedPatch
            ? undefined
            : "Edit the necessary files in the workspace and leave the real patch on disk. Do not only describe the change.",
          witnesses: [changeWitness],
        }),
        witnesses: [changeWitness],
      };
    },
  },
];

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

export function getSelectedBuiltInOracles(
  options: EvaluateCandidateRoundOptions,
): OracleDefinition[] {
  const selected = builtInOracles.filter((oracle) => oracle.roundId === options.roundId);
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
