import type { ConsultationPlanArtifact } from "../../domain/run.js";
import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";

import { dedupeStrings, resolveTaskPacketSourcePath } from "./source-paths.js";

export function materializeConsultationPlanTaskPacket(
  taskPath: string,
  consultationPlan: ConsultationPlanArtifact,
): MaterializedTaskPacket {
  const originSourceKind =
    consultationPlan.task.source.originKind ?? consultationPlan.task.source.kind;
  const originSourcePath = resolveTaskPacketSourcePath(
    taskPath,
    consultationPlan.task.source.originPath ?? consultationPlan.task.source.path,
  );
  const planningContext = [
    "Execute the persisted consultation plan contract.",
    `Planned from consultation: ${consultationPlan.runId}`,
    `Plan readiness: ${consultationPlan.readyForConsult ? "ready for consult" : "address open questions before consult"}`,
    `Task: ${consultationPlan.task.title}`,
    `Intended result: ${consultationPlan.intendedResult}`,
  ];

  if (consultationPlan.mode !== "standard") {
    planningContext.push(`Plan mode: ${consultationPlan.mode}`);
  }

  if (consultationPlan.plannedStrategies.length > 0) {
    planningContext.push(
      "Planned strategies:",
      ...consultationPlan.plannedStrategies.map(
        (strategy) => `- ${strategy.label} (${strategy.id})`,
      ),
    );
  }

  if (consultationPlan.oracleIds.length > 0) {
    planningContext.push(
      "Planned oracles:",
      ...consultationPlan.oracleIds.map((oracleId) => `- ${oracleId}`),
    );
  }

  if (consultationPlan.decisionDrivers.length > 0) {
    planningContext.push(
      "Decision drivers:",
      ...consultationPlan.decisionDrivers.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.plannedJudgingCriteria.length > 0) {
    planningContext.push(
      "Planned judging criteria:",
      ...consultationPlan.plannedJudgingCriteria.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.crownGates.length > 0) {
    planningContext.push(
      "Planned crown gates:",
      ...consultationPlan.crownGates.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.requiredChangedPaths.length > 0) {
    planningContext.push(
      "Required changed paths:",
      ...consultationPlan.requiredChangedPaths.map((targetPath) => `- ${targetPath}`),
    );
  }

  if (consultationPlan.protectedPaths.length > 0) {
    planningContext.push(
      "Protected paths:",
      ...consultationPlan.protectedPaths.map((targetPath) => `- ${targetPath}`),
    );
  }

  if (consultationPlan.openQuestions.length > 0) {
    planningContext.push(
      "Open questions:",
      ...consultationPlan.openQuestions.map((item) => `- ${item}`),
    );
  }

  appendConsultationPlanExecutionGraphContext(planningContext, consultationPlan);
  appendConsultationPlanConsensusContext(planningContext, consultationPlan);

  return materializedTaskPacketSchema.parse({
    ...consultationPlan.task,
    intent: planningContext.join("\n"),
    nonGoals: dedupeStrings([
      ...consultationPlan.task.nonGoals,
      ...consultationPlan.protectedPaths.map((targetPath) => `Do not modify ${targetPath}.`),
    ]),
    acceptanceCriteria: dedupeStrings([
      ...consultationPlan.task.acceptanceCriteria,
      ...consultationPlan.requiredChangedPaths.map((targetPath) => `Must change ${targetPath}.`),
    ]),
    oracleHints: dedupeStrings([
      ...consultationPlan.task.oracleHints,
      ...consultationPlan.oracleIds.map((oracleId) => `Planned oracle: ${oracleId}`),
    ]),
    strategyHints: dedupeStrings([
      ...consultationPlan.task.strategyHints,
      ...consultationPlan.plannedStrategies.map(
        (strategy) => `Planned strategy: ${strategy.label} (${strategy.id})`,
      ),
    ]),
    contextFiles: dedupeStrings(consultationPlan.task.contextFiles),
    source: {
      kind: "consultation-plan",
      path: taskPath,
      originKind: originSourceKind,
      originPath: originSourcePath,
    },
  });
}

function appendConsultationPlanConsensusContext(
  planningContext: string[],
  consultationPlan: ConsultationPlanArtifact,
): void {
  if (consultationPlan.selectedApproach) {
    planningContext.push("Selected approach:", consultationPlan.selectedApproach);
  }

  if (consultationPlan.rejectedApproaches.length > 0) {
    planningContext.push(
      "Rejected approaches:",
      ...consultationPlan.rejectedApproaches.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.assumptionLedger.length > 0) {
    planningContext.push(
      "Assumption ledger:",
      ...consultationPlan.assumptionLedger.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.premortem.length > 0) {
    planningContext.push(
      "Premortem risks:",
      ...consultationPlan.premortem.map((item) => `- ${item}`),
    );
  }

  if (consultationPlan.expandedTestPlan.length > 0) {
    planningContext.push(
      "Expanded test plan:",
      ...consultationPlan.expandedTestPlan.map((item) => `- ${item}`),
    );
  }
}

function appendConsultationPlanExecutionGraphContext(
  planningContext: string[],
  consultationPlan: ConsultationPlanArtifact,
): void {
  if (consultationPlan.mode === "standard") {
    return;
  }

  if (consultationPlan.workstreams.length > 0) {
    planningContext.push(
      "Planned workstreams:",
      ...consultationPlan.workstreams.flatMap((workstream) => {
        const lines = [`- ${workstream.label} (${workstream.id}): ${workstream.goal}`];
        if (workstream.targetArtifacts.length > 0) {
          lines.push(`  target artifacts: ${workstream.targetArtifacts.join(", ")}`);
        }
        if (workstream.requiredChangedPaths.length > 0) {
          lines.push(`  required paths: ${workstream.requiredChangedPaths.join(", ")}`);
        }
        if (workstream.protectedPaths.length > 0) {
          lines.push(`  protected paths: ${workstream.protectedPaths.join(", ")}`);
        }
        if (workstream.oracleIds.length > 0) {
          lines.push(`  oracle ids: ${workstream.oracleIds.join(", ")}`);
        }
        if (workstream.dependencies.length > 0) {
          lines.push(`  depends on: ${workstream.dependencies.join(", ")}`);
        }
        if (workstream.disqualifiers.length > 0) {
          lines.push(`  disqualifiers: ${workstream.disqualifiers.join(" | ")}`);
        }
        return lines;
      }),
    );
  }

  if (consultationPlan.stagePlan.length > 0) {
    planningContext.push(
      "Planned stage order:",
      ...consultationPlan.stagePlan.flatMap((stage) => {
        const lines = [`- ${stage.label} (${stage.id})`];
        if (stage.workstreamIds.length > 0) {
          lines.push(`  workstreams: ${stage.workstreamIds.join(", ")}`);
        }
        if (stage.roundIds.length > 0) {
          lines.push(`  rounds: ${stage.roundIds.join(", ")}`);
        }
        if (stage.entryCriteria.length > 0) {
          lines.push(`  entry criteria: ${stage.entryCriteria.join(" | ")}`);
        }
        if (stage.exitCriteria.length > 0) {
          lines.push(`  exit criteria: ${stage.exitCriteria.join(" | ")}`);
        }
        return lines;
      }),
    );
  }

  if (
    consultationPlan.scorecardDefinition.dimensions.length > 0 ||
    consultationPlan.scorecardDefinition.abstentionTriggers.length > 0
  ) {
    planningContext.push(
      "Planned scorecard:",
      ...(consultationPlan.scorecardDefinition.dimensions.length > 0
        ? consultationPlan.scorecardDefinition.dimensions.map(
            (dimension) => `- dimension: ${dimension}`,
          )
        : []),
      ...(consultationPlan.scorecardDefinition.abstentionTriggers.length > 0
        ? consultationPlan.scorecardDefinition.abstentionTriggers.map(
            (trigger) => `- abstain on: ${trigger}`,
          )
        : []),
    );
  }

  if (
    consultationPlan.repairPolicy.maxAttemptsPerStage > 0 ||
    consultationPlan.repairPolicy.immediateElimination.length > 0 ||
    consultationPlan.repairPolicy.repairable.length > 0 ||
    consultationPlan.repairPolicy.preferAbstainOverRetry.length > 0
  ) {
    planningContext.push(
      "Planned repair policy:",
      `- max attempts per stage: ${consultationPlan.repairPolicy.maxAttemptsPerStage}`,
      ...(consultationPlan.repairPolicy.immediateElimination.length > 0
        ? consultationPlan.repairPolicy.immediateElimination.map(
            (item) => `- immediate elimination: ${item}`,
          )
        : []),
      ...(consultationPlan.repairPolicy.repairable.length > 0
        ? consultationPlan.repairPolicy.repairable.map((item) => `- repairable: ${item}`)
        : []),
      ...(consultationPlan.repairPolicy.preferAbstainOverRetry.length > 0
        ? consultationPlan.repairPolicy.preferAbstainOverRetry.map(
            (item) => `- prefer abstain over retry: ${item}`,
          )
        : []),
    );
  }
}
