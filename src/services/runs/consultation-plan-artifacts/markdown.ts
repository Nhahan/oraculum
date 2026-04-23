import type { ConsultationPlanArtifact } from "../../../domain/run.js";

import { toDisplayPath } from "../display-path.js";

export function renderConsultationPlanMarkdown(
  plan: ConsultationPlanArtifact,
  projectRoot: string,
): string {
  const lines = [
    "# Consultation Plan",
    "",
    `- Run: ${plan.runId}`,
    `- Created: ${plan.createdAt}`,
    `- Mode: ${plan.mode}`,
    `- Ready for consult: ${plan.readyForConsult ? "yes" : "no"}`,
    `- Recommended next action: ${plan.recommendedNextAction}`,
    "",
    "## Task",
    "",
    `- Title: ${plan.task.title}`,
    `- Source: ${plan.task.source.kind} (${toDisplayPath(projectRoot, plan.task.source.path)})`,
    `- Intended result: ${plan.intendedResult}`,
    "",
    "## Decision Drivers",
    "",
    ...(plan.decisionDrivers.length > 0
      ? plan.decisionDrivers.map((item) => `- ${item}`)
      : ["- No extra decision drivers were recorded."]),
    "",
    "## Planned Judging Criteria",
    "",
    ...(plan.plannedJudgingCriteria.length > 0
      ? plan.plannedJudgingCriteria.map((item) => `- ${item}`)
      : ["- No explicit judging criteria were staged."]),
    "",
    "## Crown Gates",
    "",
    ...(plan.crownGates.length > 0
      ? plan.crownGates.map((item) => `- ${item}`)
      : ["- No extra crown gates were staged."]),
    "",
    "## Planned Strategies",
    "",
    ...(plan.plannedStrategies.length > 0
      ? plan.plannedStrategies.map((strategy) => `- ${strategy.label} (${strategy.id})`)
      : ["- No candidate strategies were staged."]),
    "",
    "## Oracle Plan",
    "",
    ...(plan.oracleIds.length > 0
      ? plan.oracleIds.map((oracleId) => `- ${oracleId}`)
      : ["- No repo-local oracle ids were selected."]),
    "",
    "## Required Changed Paths",
    "",
    ...(plan.requiredChangedPaths.length > 0
      ? plan.requiredChangedPaths.map((targetPath) => `- ${targetPath}`)
      : ["- None."]),
    "",
    "## Protected Paths",
    "",
    ...(plan.protectedPaths.length > 0
      ? plan.protectedPaths.map((targetPath) => `- ${targetPath}`)
      : ["- None."]),
    "",
    "## Repo Basis",
    "",
    `- Project root: ${toDisplayPath(projectRoot, plan.repoBasis.projectRoot)}`,
    `- Signal fingerprint: ${plan.repoBasis.signalFingerprint}`,
    ...(plan.repoBasis.availableOracleIds.length > 0
      ? plan.repoBasis.availableOracleIds.map((oracleId) => `- Available oracle: ${oracleId}`)
      : ["- Available oracle ids: none"]),
    ...(plan.repoBasis.createdFromProfileId
      ? [`- Created from profile: ${plan.repoBasis.createdFromProfileId}`]
      : []),
    ...(plan.repoBasis.createdFromPreflightDecision
      ? [`- Created from preflight decision: ${plan.repoBasis.createdFromPreflightDecision}`]
      : []),
    "",
    "## Workstreams",
    "",
    ...(plan.workstreams.length > 0
      ? plan.workstreams.flatMap((workstream) => [
          `- ${workstream.label} (${workstream.id})`,
          `  - Goal: ${workstream.goal}`,
          ...(workstream.targetArtifacts.length > 0
            ? [`  - Target artifacts: ${workstream.targetArtifacts.join(", ")}`]
            : []),
          ...(workstream.requiredChangedPaths.length > 0
            ? [`  - Required changed paths: ${workstream.requiredChangedPaths.join(", ")}`]
            : []),
          ...(workstream.protectedPaths.length > 0
            ? [`  - Protected paths: ${workstream.protectedPaths.join(", ")}`]
            : []),
          ...(workstream.oracleIds.length > 0
            ? [`  - Oracle ids: ${workstream.oracleIds.join(", ")}`]
            : []),
          ...(workstream.disqualifiers.length > 0
            ? [`  - Disqualifiers: ${workstream.disqualifiers.join(" | ")}`]
            : []),
        ])
      : ["- No workstreams were staged."]),
    "",
    "## Stage Plan",
    "",
    ...(plan.stagePlan.length > 0
      ? plan.stagePlan.flatMap((stage) => [
          `- ${stage.label} (${stage.id})`,
          ...(stage.workstreamIds.length > 0
            ? [`  - Workstreams: ${stage.workstreamIds.join(", ")}`]
            : []),
          ...(stage.roundIds.length > 0 ? [`  - Rounds: ${stage.roundIds.join(", ")}`] : []),
          ...(stage.entryCriteria.length > 0
            ? [`  - Entry criteria: ${stage.entryCriteria.join(" | ")}`]
            : []),
          ...(stage.exitCriteria.length > 0
            ? [`  - Exit criteria: ${stage.exitCriteria.join(" | ")}`]
            : []),
        ])
      : ["- No staged execution plan was recorded."]),
    "",
    "## Scorecard Definition",
    "",
    ...(plan.scorecardDefinition.dimensions.length > 0
      ? plan.scorecardDefinition.dimensions.map((dimension) => `- Dimension: ${dimension}`)
      : ["- Dimensions: none"]),
    ...(plan.scorecardDefinition.abstentionTriggers.length > 0
      ? plan.scorecardDefinition.abstentionTriggers.map((trigger) => `- Abstain on: ${trigger}`)
      : ["- Abstention triggers: none"]),
    "",
    "## Repair Policy",
    "",
    `- Max attempts per stage: ${plan.repairPolicy.maxAttemptsPerStage}`,
    ...(plan.repairPolicy.immediateElimination.length > 0
      ? plan.repairPolicy.immediateElimination.map((item) => `- Immediate elimination: ${item}`)
      : ["- Immediate elimination: none"]),
    ...(plan.repairPolicy.repairable.length > 0
      ? plan.repairPolicy.repairable.map((item) => `- Repairable: ${item}`)
      : ["- Repairable: none"]),
    ...(plan.repairPolicy.preferAbstainOverRetry.length > 0
      ? plan.repairPolicy.preferAbstainOverRetry.map(
          (item) => `- Prefer abstain over retry: ${item}`,
        )
      : ["- Prefer abstain over retry: none"]),
    "",
    "## Deep Planning",
    "",
    ...(plan.planningSpecPath ? [`- Planning spec: ${plan.planningSpecPath}`] : []),
    ...(plan.planningInterviewPath ? [`- Planning interview: ${plan.planningInterviewPath}`] : []),
    ...(plan.planConsensusPath ? [`- Plan consensus: ${plan.planConsensusPath}`] : []),
    ...(plan.clarityGate
      ? [
          `- Clarity gate: ${plan.clarityGate.status}`,
          `- Clarity summary: ${plan.clarityGate.summary}`,
          ...(plan.clarityGate.score !== undefined
            ? [`- Clarity score: ${plan.clarityGate.score}`]
            : []),
          ...(plan.clarityGate.weakestDimension
            ? [`- Weakest dimension: ${plan.clarityGate.weakestDimension}`]
            : []),
        ]
      : ["- No deep planning gate was recorded."]),
    ...(plan.selectedApproach ? [`- Selected approach: ${plan.selectedApproach}`] : []),
    ...(plan.rejectedApproaches.length > 0
      ? plan.rejectedApproaches.map((item) => `- Rejected approach: ${item}`)
      : []),
    ...(plan.assumptionLedger.length > 0
      ? plan.assumptionLedger.map((item) => `- Assumption: ${item}`)
      : []),
    ...(plan.premortem.length > 0 ? plan.premortem.map((item) => `- Premortem: ${item}`) : []),
    ...(plan.expandedTestPlan.length > 0
      ? plan.expandedTestPlan.map((item) => `- Expanded test: ${item}`)
      : []),
    "",
    "## Round Order",
    "",
    ...(plan.roundOrder.length > 0
      ? plan.roundOrder.map((round) => `- ${round.label} (${round.id})`)
      : ["- No rounds were planned."]),
    "",
    "## Open Questions",
    "",
    ...(plan.openQuestions.length > 0
      ? plan.openQuestions.map((item) => `- ${item}`)
      : ["- None."]),
    "",
    "## Next Step",
    "",
    `- ${plan.recommendedNextAction}`,
  ];

  if (plan.profileSelection) {
    lines.push(
      "",
      "## Validation Posture",
      "",
      `- Profile: ${plan.profileSelection.validationProfileId}`,
      `- Confidence: ${plan.profileSelection.confidence}`,
      `- Summary: ${plan.profileSelection.validationSummary}`,
    );
  }

  if (plan.preflight) {
    lines.push(
      "",
      "## Preflight",
      "",
      `- Decision: ${plan.preflight.decision}`,
      `- Confidence: ${plan.preflight.confidence}`,
      `- Summary: ${plan.preflight.summary}`,
    );
    if (plan.preflight.clarificationQuestion) {
      lines.push(`- Clarification question: ${plan.preflight.clarificationQuestion}`);
    }
    if (plan.preflight.researchQuestion) {
      lines.push(`- Research question: ${plan.preflight.researchQuestion}`);
    }
  }

  return lines.join("\n");
}
