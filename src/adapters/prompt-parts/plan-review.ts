import type { AgentPlanReviewRequest } from "../types.js";

export function buildPlanReviewPrompt(request: AgentPlanReviewRequest): string {
  const plan = request.consultationPlan;
  const lines = [
    "You are reviewing an Oraculum consultation plan before candidate generation.",
    "Do not solve the task and do not propose implementations. Only decide whether the plan is ready to execute.",
    "",
    "Return JSON matching the provided schema.",
    "",
    "Review contract:",
    "- status `clear` means the plan is ready.",
    "- status `issues` means non-blocking concerns should be shown as warnings.",
    "- status `blocked` means candidate generation must not start until the plan is rerun or revised.",
    "- Treat unresolved questions, stale basis, missing planned oracles, weak crown gates, and undefined repair policy as blockers.",
    "",
    "Consultation plan:",
    JSON.stringify(
      {
        runId: plan.runId,
        mode: plan.mode,
        readyForConsult: plan.readyForConsult,
        intendedResult: plan.intendedResult,
        decisionDrivers: plan.decisionDrivers,
        plannedJudgingCriteria: plan.plannedJudgingCriteria,
        crownGates: plan.crownGates,
        openQuestions: plan.openQuestions,
        repoBasis: plan.repoBasis,
        candidateCount: plan.candidateCount,
        plannedStrategies: plan.plannedStrategies,
        oracleIds: plan.oracleIds,
        requiredChangedPaths: plan.requiredChangedPaths,
        protectedPaths: plan.protectedPaths,
        roundOrder: plan.roundOrder,
        workstreams: plan.workstreams,
        stagePlan: plan.stagePlan,
        scorecardDefinition: plan.scorecardDefinition,
        repairPolicy: plan.repairPolicy,
        task: {
          title: plan.task.title,
          artifactKind: plan.task.artifactKind,
          targetArtifactPath: plan.task.targetArtifactPath,
          acceptanceCriteria: plan.task.acceptanceCriteria,
          risks: plan.task.risks,
          oracleHints: plan.task.oracleHints,
          strategyHints: plan.task.strategyHints,
        },
      },
      null,
      2,
    ),
  ];

  return `${lines.join("\n")}\n`;
}
