import {
  type ClarifyPressureSummary,
  type PressureAgentBreakdown,
  type PressureEvidenceCase,
  type PressurePromotionSignal,
  type PressureRecurringReason,
  type PressureRepeatedJudgingCriteriaSet,
  type PressureRepeatedSource,
  type PressureRepeatedStrategySet,
  type PressureRepeatedTarget,
  type PressureRepeatedTask,
  type PressureTrajectory,
  pressurePromotionSignalSchema,
} from "./schema.js";
import { buildRecentCluster } from "./shared.js";

export function buildClarifyPromotionSignal(
  cases: PressureEvidenceCase[],
  _agentBreakdown: PressureAgentBreakdown[],
  repeatedTasks: ClarifyPressureSummary["repeatedTasks"],
  repeatedSources: ClarifyPressureSummary["repeatedSources"],
  repeatedTargets: ClarifyPressureSummary["repeatedTargets"],
  pressureTrajectories: PressureTrajectory[],
  recurringReasons: PressureRecurringReason[],
): PressurePromotionSignal {
  const distinctRunCount = new Set(cases.map((item) => item.runId)).size;
  const reasons: string[] = [];

  if (distinctRunCount >= 3) {
    reasons.push(`${distinctRunCount} consultations ended in clarify pressure.`);
  }
  if (repeatedTasks.some((item) => item.occurrenceCount >= 3)) {
    reasons.push(
      "The same task required clarification or external research in at least 3 consultations.",
    );
  }
  if (repeatedTargets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same target artifact accumulated repeated clarify pressure across consultations.",
    );
  }
  if (repeatedSources.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same task source accumulated repeated clarify pressure across consultations.",
    );
  }
  const recentCluster = buildRecentCluster(cases);
  if (recentCluster.recentRunCount >= 3) {
    reasons.push(
      `${recentCluster.recentRunCount} clarify-pressure consultations landed within the recent ${recentCluster.windowDays}-day cluster.`,
    );
  }
  if (pressureTrajectories.some((item) => item.distinctKinds.length >= 2)) {
    reasons.push("The same clarify scope moved across multiple pressure kinds.");
  }
  if (pressureTrajectories.some((item) => item.agents.length >= 2)) {
    reasons.push("The same clarify pressure trajectory crossed multiple hosts.");
  }
  if (pressureTrajectories.some((item) => item.containsEscalation)) {
    reasons.push("At least one clarify trajectory escalated into a stronger blocker.");
  }
  if (recurringReasons.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same clarification or research blocker repeated across multiple consultations.",
    );
  }

  return pressurePromotionSignalSchema.parse({
    shouldPromote: reasons.length > 0,
    distinctRunCount,
    reasons,
  });
}

export function buildFinalistPromotionSignal(
  cases: PressureEvidenceCase[],
  _agentBreakdown: PressureAgentBreakdown[],
  repeatedTasks: PressureRepeatedTask[],
  repeatedSources: PressureRepeatedSource[],
  repeatedTargets: PressureRepeatedTarget[],
  repeatedStrategySets: PressureRepeatedStrategySet[],
  repeatedJudgingCriteriaSets: PressureRepeatedJudgingCriteriaSet[],
  pressureTrajectories: PressureTrajectory[],
  recurringReasons: PressureRecurringReason[],
): PressurePromotionSignal {
  const distinctRunCount = new Set(cases.map((item) => item.runId)).size;
  const judgeAbstainCases = cases.filter((item) => item.kind === "judge-abstain").length;
  const manualCrowningCases = cases.filter(
    (item) => item.kind === "manual-crowning-handoff",
  ).length;
  const lowConfidenceCases = cases.filter(
    (item) => item.kind === "low-confidence-recommendation",
  ).length;
  const secondOpinionDisagreementCases = cases.filter(
    (item) => item.kind === "second-opinion-disagreement",
  ).length;
  const reasons: string[] = [];

  if (judgeAbstainCases >= 2) {
    reasons.push(`${judgeAbstainCases} consultations recorded judge abstain outcomes.`);
  }
  if (manualCrowningCases >= 2) {
    reasons.push(`${manualCrowningCases} consultations required manual crowning handoff.`);
  }
  if (lowConfidenceCases >= 2) {
    reasons.push(`${lowConfidenceCases} consultations selected low-confidence winners.`);
  }
  if (secondOpinionDisagreementCases >= 2) {
    reasons.push(
      `${secondOpinionDisagreementCases} consultations recorded advisory second-opinion disagreement with the recommended result.`,
    );
  }
  if (repeatedTasks.some((item) => item.occurrenceCount >= 2) && cases.length >= 3) {
    reasons.push(
      "The same task accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedTargets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same target artifact accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedSources.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same task source accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedStrategySets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same finalist strategy mix accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  if (repeatedJudgingCriteriaSets.some((item) => item.occurrenceCount >= 2)) {
    reasons.push(
      "The same judging-criteria set accumulated repeated finalist-selection pressure across consultations.",
    );
  }
  const recentCluster = buildRecentCluster(cases);
  if (recentCluster.recentRunCount >= 2 && cases.length >= 3) {
    reasons.push(
      `${recentCluster.recentRunCount} finalist-pressure consultations landed within the recent ${recentCluster.windowDays}-day cluster.`,
    );
  }
  if (pressureTrajectories.some((item) => item.agents.length >= 2)) {
    reasons.push("The same finalist-selection pressure trajectory crossed multiple hosts.");
  }
  if (pressureTrajectories.some((item) => item.containsEscalation)) {
    reasons.push("At least one finalist-selection trajectory escalated into a stronger blocker.");
  }
  if (recurringReasons.some((item) => item.occurrenceCount >= 2)) {
    reasons.push("The same finalist-selection blocker repeated across multiple consultations.");
  }

  return pressurePromotionSignalSchema.parse({
    shouldPromote: reasons.length > 0,
    distinctRunCount,
    reasons,
  });
}
