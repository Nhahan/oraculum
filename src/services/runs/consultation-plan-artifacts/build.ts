import { createHash } from "node:crypto";

import type { ProjectConfig, Strategy } from "../../../domain/config.js";
import type { ConsultationProfileSelection } from "../../../domain/profile.js";
import {
  type ConsultationClarifyFollowUp,
  type ConsultationPlanArtifact,
  consultationPlanArtifactSchema,
  type RunManifest,
} from "../../../domain/run.js";
import {
  describeRecommendedTaskResultLabel,
  type MaterializedTaskPacket,
} from "../../../domain/task.js";

import type { ConsultationPlanArtifactWriterOptions } from "./types.js";

export function buildConsultationPlanArtifact(
  options: ConsultationPlanArtifactWriterOptions,
): ConsultationPlanArtifact {
  return consultationPlanArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    mode: "standard",
    readyForConsult:
      options.preflight?.decision !== undefined ? options.preflight.decision === "proceed" : true,
    recommendedNextAction: buildConsultationPlanNextAction(options),
    intendedResult: describeRecommendedTaskResultLabel({
      ...(options.taskPacket.artifactKind ? { artifactKind: options.taskPacket.artifactKind } : {}),
      ...(options.taskPacket.targetArtifactPath
        ? { targetArtifactPath: options.taskPacket.targetArtifactPath }
        : {}),
    }),
    decisionDrivers: buildConsultationPlanDecisionDrivers(options),
    plannedJudgingCriteria: buildConsultationPlanJudgingCriteria(options),
    crownGates: buildConsultationPlanCrownGates(options),
    openQuestions: buildConsultationPlanOpenQuestions(options),
    task: options.taskPacket,
    ...(options.preflight ? { preflight: options.preflight } : {}),
    ...(options.profileSelection ? { profileSelection: options.profileSelection } : {}),
    repoBasis: buildConsultationPlanRepoBasis(options),
    candidateCount: options.candidateCount,
    plannedStrategies: options.strategies,
    oracleIds: options.config.oracles.map((oracle) => oracle.id),
    requiredChangedPaths: options.taskPacket.targetArtifactPath
      ? [options.taskPacket.targetArtifactPath]
      : [],
    protectedPaths: [],
    roundOrder: options.config.rounds.map((round) => ({
      id: round.id,
      label: round.label,
    })),
    workstreams: buildConsultationPlanWorkstreams(options),
    stagePlan: buildConsultationPlanStagePlan(options),
    scorecardDefinition: buildConsultationPlanScorecardDefinition(options),
    repairPolicy: buildConsultationPlanRepairPolicy(options),
  });
}

function buildConsultationPlanRepoBasis(options: {
  projectRoot: string;
  config: ProjectConfig;
  preflight?: RunManifest["preflight"];
  profileSelection?: ConsultationProfileSelection;
  strategies: Array<Pick<Strategy, "id" | "label">>;
  taskPacket: MaterializedTaskPacket;
}) {
  const signalFingerprintInput = {
    taskId: options.taskPacket.id,
    artifactKind: options.taskPacket.artifactKind ?? null,
    targetArtifactPath: options.taskPacket.targetArtifactPath ?? null,
    strategyIds: options.strategies.map((strategy) => strategy.id),
    oracleIds: options.config.oracles.map((oracle) => oracle.id),
    roundIds: options.config.rounds.map((round) => round.id),
    validationProfileId: options.profileSelection?.validationProfileId ?? null,
    preflightDecision: options.preflight?.decision ?? null,
  };

  return {
    projectRoot: options.projectRoot,
    signalFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(signalFingerprintInput)).digest("hex")}`,
    availableOracleIds: options.config.oracles.map((oracle) => oracle.id),
    ...(options.profileSelection?.validationProfileId
      ? { createdFromProfileId: options.profileSelection.validationProfileId }
      : {}),
    ...(options.preflight?.decision
      ? { createdFromPreflightDecision: options.preflight.decision }
      : {}),
  };
}

function buildConsultationPlanWorkstreams(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  const targetArtifacts = options.taskPacket.targetArtifactPath
    ? [options.taskPacket.targetArtifactPath]
    : [];
  const requiredChangedPaths = options.taskPacket.targetArtifactPath
    ? [options.taskPacket.targetArtifactPath]
    : [];
  const disqualifiers = options.taskPacket.targetArtifactPath
    ? [
        `Do not satisfy the task without materially changing ${options.taskPacket.targetArtifactPath}.`,
      ]
    : [];

  return [
    {
      id: "primary-contract",
      label: "Primary Contract",
      goal: describeRecommendedTaskResultLabel({
        ...(options.taskPacket.artifactKind
          ? { artifactKind: options.taskPacket.artifactKind }
          : {}),
        ...(options.taskPacket.targetArtifactPath
          ? { targetArtifactPath: options.taskPacket.targetArtifactPath }
          : {}),
      }),
      targetArtifacts,
      requiredChangedPaths,
      protectedPaths: [],
      oracleIds: options.config.oracles.map((oracle) => oracle.id),
      dependencies: [],
      risks: options.taskPacket.risks,
      disqualifiers,
    },
  ];
}

function buildConsultationPlanStagePlan(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  return [
    {
      id: "primary-stage",
      label: "Primary Stage",
      dependsOn: [],
      workstreamIds: ["primary-contract"],
      roundIds: options.config.rounds.map((round) => round.id),
      entryCriteria: ["Consultation plan basis remains current."],
      exitCriteria: options.taskPacket.targetArtifactPath
        ? [`Materially change ${options.taskPacket.targetArtifactPath}.`]
        : ["Leave a materialized, reviewable result in the workspace."],
    },
  ];
}

function buildConsultationPlanScorecardDefinition(options: { taskPacket: MaterializedTaskPacket }) {
  const dimensions = new Set<string>(["oracle-pass-summary", "artifact-coherence"]);
  if (options.taskPacket.targetArtifactPath) {
    dimensions.add("target-artifact-coverage");
    dimensions.add("required-path-coverage");
  }

  return {
    dimensions: [...dimensions],
    abstentionTriggers: options.taskPacket.targetArtifactPath
      ? [`Missing target coverage for ${options.taskPacket.targetArtifactPath}.`]
      : [],
  };
}

function buildConsultationPlanRepairPolicy(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  return {
    maxAttemptsPerStage: options.config.repair.enabled
      ? options.config.repair.maxAttemptsPerRound
      : 0,
    immediateElimination: [],
    repairable: options.taskPacket.targetArtifactPath ? ["missing-target-coverage"] : [],
    preferAbstainOverRetry: [],
  };
}

function buildConsultationPlanDecisionDrivers(options: {
  preflight?: RunManifest["preflight"];
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const drivers = new Set<string>();

  if (options.taskPacket.artifactKind) {
    drivers.add(`Target artifact kind: ${options.taskPacket.artifactKind}`);
  }
  if (options.taskPacket.targetArtifactPath) {
    drivers.add(`Target artifact path: ${options.taskPacket.targetArtifactPath}`);
  }
  if (options.preflight) {
    drivers.add(`Preflight posture: ${options.preflight.researchPosture}`);
    drivers.add(`Preflight decision: ${options.preflight.decision}`);
  }
  if (options.profileSelection) {
    drivers.add(`Validation posture: ${options.profileSelection.validationProfileId}`);
    for (const signal of options.profileSelection.validationSignals) {
      drivers.add(`Validation signal: ${signal}`);
    }
  }

  return [...drivers];
}

function buildConsultationPlanJudgingCriteria(options: {
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const criteria = new Set<string>();

  if (options.taskPacket.targetArtifactPath) {
    criteria.add(
      `Directly improves ${options.taskPacket.targetArtifactPath} instead of only adjacent files.`,
    );
  }
  if (options.taskPacket.artifactKind) {
    criteria.add(
      `Leaves the planned ${options.taskPacket.artifactKind} result internally consistent and reviewable.`,
    );
  }
  if (options.profileSelection?.validationProfileId) {
    criteria.add(
      `Leaves evidence strong enough for the selected ${options.profileSelection.validationProfileId} validation posture.`,
    );
  }

  return [...criteria];
}

function buildConsultationPlanCrownGates(options: {
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const gates = new Set<string>();

  if (options.taskPacket.targetArtifactPath) {
    gates.add(
      `Do not recommend finalists that fail to materially change ${options.taskPacket.targetArtifactPath}.`,
    );
  }
  if (options.taskPacket.artifactKind) {
    gates.add(
      `Abstain if no finalist leaves the planned ${options.taskPacket.artifactKind} result reviewable and internally consistent.`,
    );
  }
  if ((options.profileSelection?.validationGaps.length ?? 0) > 0) {
    gates.add(
      "Abstain when the remaining finalist evidence is too weak to overcome the selected validation gaps.",
    );
  }

  return [...gates];
}

function buildConsultationPlanOpenQuestions(options: {
  preflight?: RunManifest["preflight"];
  clarifyFollowUp?: ConsultationClarifyFollowUp;
}): string[] {
  const questions = new Set<string>();

  if (options.preflight?.clarificationQuestion) {
    questions.add(options.preflight.clarificationQuestion);
  }
  if (options.preflight?.researchQuestion) {
    questions.add(options.preflight.researchQuestion);
  }
  if (options.clarifyFollowUp?.keyQuestion) {
    questions.add(options.clarifyFollowUp.keyQuestion);
  }
  if (options.clarifyFollowUp?.missingResultContract) {
    questions.add(`Missing result contract: ${options.clarifyFollowUp.missingResultContract}`);
  }
  if (options.clarifyFollowUp?.missingJudgingBasis) {
    questions.add(`Missing judging basis: ${options.clarifyFollowUp.missingJudgingBasis}`);
  }

  return [...questions];
}

function buildConsultationPlanNextAction(options: {
  preflight?: RunManifest["preflight"];
  projectRoot: string;
  runId: string;
}): string {
  const planPath = `.oraculum/runs/${options.runId}/reports/consultation-plan.json`;

  switch (options.preflight?.decision) {
    case "needs-clarification":
      return 'Answer the clarification question, then rerun `orc plan <task> --answer "<answer>"` or revise the task contract before `orc consult`.';
    case "external-research-required":
      return "Gather bounded external research, refresh the task contract, and rerun `orc consult` or `orc plan`.";
    case "abstain":
      return "Revise the task scope or repository setup before rerunning the consultation.";
    case "proceed":
    case undefined:
      return `Execute the planned consultation: \`orc consult ${planPath}\`.`;
  }
}
