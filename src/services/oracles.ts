import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, isAbsolute, normalize, relative, resolve } from "node:path";

import type { AgentRunResult } from "../adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateLogsDir,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
} from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import type { OracleEnforcement, ProjectConfig, RepoOracle, RoundId } from "../domain/config.js";
import {
  type OracleVerdict,
  oracleVerdictSchema,
  type Witness,
  witnessSchema,
} from "../domain/oracle.js";
import type {
  CandidateManifest,
  CandidateScorecardStageResult,
  ConsultationPlanArtifact,
  ConsultationPlanStage,
  ConsultationPlanWorkstream,
} from "../domain/run.js";
import type { MaterializedTaskPacket } from "../domain/task.js";
import { collectCandidateChangeInsight } from "./change-insights.js";
import {
  collectOracleLocalToolPaths,
  resolveRepoLocalEntrypointCommand,
  resolveRepoLocalWrapperCommand,
} from "./oracle-local-tools.js";

interface EvaluateCandidateRoundOptions {
  candidate: CandidateManifest;
  projectConfig: ProjectConfig;
  projectRoot: string;
  result: AgentRunResult;
  roundId: RoundId;
  runId: string;
  taskPacket: MaterializedTaskPacket;
  consultationPlan?: ConsultationPlanArtifact;
}

interface EvaluateCandidateRoundResult {
  survives: boolean;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

interface OracleEvaluation {
  verdict: OracleVerdict;
  witnesses: Witness[];
}

export interface EvaluateConsultationPlanStageOptions {
  candidate: CandidateManifest;
  completedStageResults: CandidateScorecardStageResult[];
  consultationPlan: ConsultationPlanArtifact;
  existingVerdicts: OracleVerdict[];
  projectConfig: ProjectConfig;
  projectRoot: string;
  result: AgentRunResult;
  runId: string;
  stage: ConsultationPlanStage;
}

export interface EvaluateConsultationPlanStageResult {
  roundId: RoundId;
  stageResult: CandidateScorecardStageResult;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

interface OracleDefinition {
  evaluate(options: EvaluateCandidateRoundOptions): Promise<OracleEvaluation> | OracleEvaluation;
  oracleId: string;
  roundId: RoundId;
}

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

export async function evaluateCandidateRound(
  options: EvaluateCandidateRoundOptions,
): Promise<EvaluateCandidateRoundResult> {
  if (options.roundId !== "fast" && options.result.status !== "completed") {
    return {
      survives: false,
      verdicts: [],
      witnesses: [],
    };
  }

  const verdicts: OracleVerdict[] = [];
  const witnesses: Witness[] = [];

  const selectedBuiltIns = getSelectedBuiltInOracles(options);
  for (const oracle of selectedBuiltIns) {
    const evaluation = await oracle.evaluate(options);
    verdicts.push(evaluation.verdict);
    witnesses.push(...evaluation.witnesses);
  }

  const selectedRepoOracles = options.projectConfig.oracles.filter(
    (oracle) => oracle.roundId === options.roundId,
  );
  if (options.result.status === "completed") {
    for (const oracle of selectedRepoOracles) {
      const evaluation = await evaluateRepoOracle(options, oracle);
      verdicts.push(evaluation.verdict);
      witnesses.push(...evaluation.witnesses);
    }
  }

  return {
    survives: verdicts.every((verdict) => verdict.status === "pass" || verdict.status === "skip"),
    verdicts,
    witnesses,
  };
}

function getSelectedBuiltInOracles(options: EvaluateCandidateRoundOptions): OracleDefinition[] {
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

function normalizeProjectRelativePath(targetPath: string): string {
  const normalized = normalize(targetPath).replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function hasWorkstreamCoverage(
  workstream: ConsultationPlanWorkstream,
  changedPaths: string[],
): boolean {
  const requiredChangedPaths = workstream.requiredChangedPaths.map(normalizeProjectRelativePath);
  if (requiredChangedPaths.length > 0) {
    return requiredChangedPaths.every((targetPath) => changedPaths.includes(targetPath));
  }

  const targetArtifacts = workstream.targetArtifacts.map(normalizeProjectRelativePath);
  if (targetArtifacts.length > 0) {
    return targetArtifacts.some((targetPath) => changedPaths.includes(targetPath));
  }

  return false;
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

function resolveConsultationPlanStageRoundId(stage: ConsultationPlanStage): RoundId {
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
    if (visited.has(workstream.id)) {
      return;
    }
    if (visiting.has(workstream.id)) {
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

async function evaluateRepoOracle(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
): Promise<OracleEvaluation> {
  const logDir = getCandidateLogsDir(options.projectRoot, options.runId, options.candidate.id);
  const stdoutPath = getCandidateOracleStdoutLogPath(
    options.projectRoot,
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );
  const stderrPath = getCandidateOracleStderrLogPath(
    options.projectRoot,
    options.runId,
    options.candidate.id,
    oracle.roundId,
    oracle.id,
  );

  await mkdir(logDir, { recursive: true });

  try {
    const oracleCwd = resolveOracleCwd(options, oracle);
    const scopeRoot =
      oracle.cwd === "project" ? options.projectRoot : options.candidate.workspaceDir;
    const resolvedEntrypoint = resolveRepoLocalEntrypointCommand({
      command: oracle.command,
      cwd: oracleCwd,
      exists: existsSync,
    });
    const resolvedCommand =
      resolvedEntrypoint.resolution !== "unresolved"
        ? resolvedEntrypoint
        : resolveRepoLocalWrapperCommand({
            command: oracle.command,
            exists: existsSync,
            projectRoot: options.projectRoot,
            scopeRoot,
          });
    const shell =
      oracle.shell ?? inferRepoOracleShell(resolvedCommand.resolvedCommand, oracle.args);
    const commandResult = await runSubprocess({
      command: resolvedCommand.resolvedCommand,
      args: oracle.args,
      cwd: oracleCwd,
      env: buildOracleEnvironment(options, oracle, oracleCwd),
      inheritEnv: false,
      ...(shell !== undefined ? { shell } : {}),
      ...(oracle.timeoutMs !== undefined ? { timeoutMs: oracle.timeoutMs } : {}),
    });

    await Promise.all([
      writeFile(stdoutPath, commandResult.stdout, "utf8"),
      writeFile(stderrPath, commandResult.stderr, "utf8"),
    ]);

    const failed = commandResult.exitCode !== 0 || commandResult.timedOut;
    const failureMapping = mapFailureEnforcement(oracle.enforcement);
    const status = failed ? failureMapping.status : "pass";
    const severity = failed ? failureMapping.severity : "info";
    const preferredPath = failed ? stderrPath : stdoutPath;
    const excerpt = summarizeOracleOutput(commandResult.stderr, commandResult.stdout);
    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-${oracle.id}`,
      kind: "command-output",
      title: `Repo-local oracle ${oracle.id}`,
      detail: buildOracleWitnessDetail(
        options,
        oracle,
        oracleCwd,
        resolvedCommand,
        commandResult.exitCode,
        commandResult.timedOut,
      ),
      path: preferredPath,
      ...(excerpt ? { excerpt } : {}),
      scope: [options.candidate.id, oracle.id],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: oracle.id,
        roundId: oracle.roundId,
        status,
        severity,
        summary: failed
          ? (oracle.failureSummary ??
            buildFailureSummary(oracle, commandResult.exitCode, commandResult.timedOut))
          : (oracle.passSummary ?? `Repo-local oracle "${oracle.id}" passed.`),
        invariant: oracle.invariant,
        confidence: oracle.confidence,
        ...(failed && oracle.repairHint ? { repairHint: oracle.repairHint } : {}),
        affectedScope: [options.candidate.id],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      writeFile(stdoutPath, "", "utf8"),
      writeFile(stderrPath, `${message}\n`, "utf8"),
    ]);

    const witness = witnessSchema.parse({
      id: `${options.candidate.id}-${oracle.id}`,
      kind: "command-output",
      title: `Repo-local oracle ${oracle.id}`,
      detail: `Repo-local oracle command could not start: ${message}`,
      path: stderrPath,
      excerpt: message.slice(0, 500),
      scope: [options.candidate.id, oracle.id],
    });

    return {
      verdict: oracleVerdictSchema.parse({
        oracleId: oracle.id,
        roundId: oracle.roundId,
        status: "fail",
        severity: "critical",
        summary: oracle.failureSummary ?? `Repo-local oracle "${oracle.id}" could not start.`,
        invariant: oracle.invariant,
        confidence: oracle.confidence,
        ...(oracle.repairHint ? { repairHint: oracle.repairHint } : {}),
        affectedScope: [options.candidate.id],
        witnesses: [witness],
      }),
      witnesses: [witness],
    };
  }
}

function buildOracleEnvironment(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
  oracleCwd: string,
): NodeJS.ProcessEnv {
  const explicitPathEntry = Object.entries(oracle.env ?? {}).find(
    ([key]) => key.toUpperCase() === "PATH",
  );
  const pathKey =
    explicitPathEntry?.[0] ??
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const inheritedPath = explicitPathEntry ? explicitPathEntry[1] : process.env[pathKey];
  const localToolPaths = collectOracleLocalToolPaths({
    exists: existsSync,
    projectRoot: options.projectRoot,
    workspaceDir: options.candidate.workspaceDir,
  });
  const oraclePath =
    explicitPathEntry !== undefined
      ? inheritedPath
      : oracle.pathPolicy === "inherit" && inheritedPath
        ? [...localToolPaths, inheritedPath].join(delimiter)
        : localToolPaths.join(delimiter);

  return {
    ...oracle.env,
    ORACULUM_ORACLE_ARGS_JSON: JSON.stringify(oracle.args),
    ORACULUM_PROJECT_ROOT: options.projectRoot,
    ORACULUM_RUN_ID: options.runId,
    ORACULUM_ROUND_ID: options.roundId,
    ORACULUM_AGENT: options.result.adapter,
    ORACULUM_AGENT_STATUS: options.result.status,
    ORACULUM_CANDIDATE_ID: options.candidate.id,
    ORACULUM_CANDIDATE_STRATEGY_ID: options.candidate.strategyId,
    ORACULUM_CANDIDATE_STRATEGY_LABEL: options.candidate.strategyLabel,
    ORACULUM_CANDIDATE_WORKSPACE_DIR: options.candidate.workspaceDir,
    ORACULUM_ORACLE_CWD: oracleCwd,
    ORACULUM_ORACLE_PATH_POLICY: oracle.pathPolicy,
    ORACULUM_CANDIDATE_LOG_DIR: getCandidateLogsDir(
      options.projectRoot,
      options.runId,
      options.candidate.id,
    ),
    ORACULUM_CANDIDATE_TASK_PACKET_PATH: options.candidate.taskPacketPath,
    ORACULUM_CANDIDATE_AGENT_RESULT_PATH: getCandidateAgentResultPath(
      options.projectRoot,
      options.runId,
      options.candidate.id,
    ),
    ...(oraclePath !== undefined ? { [pathKey]: oraclePath } : {}),
  };
}

function resolveOracleCwd(options: EvaluateCandidateRoundOptions, oracle: RepoOracle): string {
  const scopeRoot = oracle.cwd === "project" ? options.projectRoot : options.candidate.workspaceDir;
  if (!oracle.relativeCwd) {
    return scopeRoot;
  }

  const resolved = resolve(scopeRoot, oracle.relativeCwd);
  const relativePath = relative(scopeRoot, resolved);
  if (isContainedRelativePath(relativePath)) {
    const realScopeRoot = realpathSync(scopeRoot);
    const realResolved = existsSync(resolved) ? realpathSync(resolved) : resolved;
    if (isContainedRelativePath(relative(realScopeRoot, realResolved))) {
      return resolved;
    }
  }

  throw new Error(`Oracle "${oracle.id}" relativeCwd escapes the ${oracle.cwd} scope.`);
}

function isContainedRelativePath(relativePath: string): boolean {
  if (relativePath === "") {
    return true;
  }

  const firstSegment = relativePath.split(/[\\/]+/u)[0];
  return firstSegment !== ".." && !isAbsolute(relativePath);
}

function inferRepoOracleShell(command: string, args: string[]): boolean | undefined {
  if (args.length === 0) {
    return true;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const base = basename(command).toLowerCase();
  if (["bun", "npm", "npx", "pnpm", "yarn", "yarnpkg"].includes(base)) {
    return true;
  }

  return undefined;
}

function buildFailureSummary(oracle: RepoOracle, exitCode: number, timedOut: boolean): string {
  if (timedOut) {
    return `Repo-local oracle "${oracle.id}" timed out.`;
  }

  return `Repo-local oracle "${oracle.id}" failed with exit code ${exitCode}.`;
}

function buildOracleWitnessDetail(
  options: EvaluateCandidateRoundOptions,
  oracle: RepoOracle,
  oracleCwd: string,
  resolvedCommand: {
    resolvedCommand: string;
    resolution: "local-entrypoint" | "project-wrapper" | "workspace-wrapper" | "unresolved";
  },
  exitCode: number,
  timedOut: boolean,
): string {
  return [
    `Command exited with code ${exitCode}.`,
    timedOut ? "The command timed out." : undefined,
    `Scope=${oracle.cwd === "project" ? "project" : "workspace"}.`,
    oracle.relativeCwd ? `RelativeCwd=${oracle.relativeCwd}.` : undefined,
    resolvedCommand.resolution !== "unresolved"
      ? `ResolvedCommand=${resolvedCommand.resolvedCommand} (${resolvedCommand.resolution}).`
      : undefined,
    `PathPolicy=${oracle.pathPolicy}.`,
    oracle.safetyRationale ? `Safety=${oracle.safetyRationale}` : undefined,
    `OracleCwd=${oracleCwd}.`,
    `Workspace=${options.candidate.workspaceDir}.`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

function mapFailureEnforcement(enforcement: OracleEnforcement): {
  severity: OracleVerdict["severity"];
  status: OracleVerdict["status"];
} {
  switch (enforcement) {
    case "hard":
      return { status: "fail", severity: "error" };
    case "repairable":
      return { status: "repairable", severity: "warning" };
    case "signal":
      return { status: "pass", severity: "warning" };
  }
}

function summarizeOracleOutput(stderr: string, stdout: string): string | undefined {
  const preferred = stderr.trim() || stdout.trim();
  return preferred ? preferred.slice(0, 500) : undefined;
}
