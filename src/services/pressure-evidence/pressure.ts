import {
  buildClarifyCoverageBlindSpots,
  buildCoverageGapRuns,
  buildFinalistCoverageBlindSpots,
  buildMissingArtifactBreakdown,
  buildPressureArtifactCoverage,
  buildPressureMetadataCoverage,
  getClarifyMissingArtifacts,
  getFinalistMissingArtifacts,
} from "./coverage.js";
import {
  buildAgentBreakdown,
  buildPressureTrajectories,
  buildRecurringReasons,
  buildRepeatedJudgingCriteriaSets,
  buildRepeatedSources,
  buildRepeatedStrategySets,
  buildRepeatedTargets,
  buildRepeatedTasks,
} from "./grouping.js";
import { buildClarifyInspectionQueue, buildFinalistInspectionQueue } from "./inspection.js";
import {
  type ClarifyPressureSummary,
  clarifyPressureSummarySchema,
  type FinalistSelectionPressureSummary,
  finalistSelectionPressureSummarySchema,
  type PressureEvidenceCase,
} from "./schema.js";
import { buildExpectedClarifyFollowUpRunIds, buildRecentCluster } from "./shared.js";
import { buildClarifyPromotionSignal, buildFinalistPromotionSignal } from "./signals.js";

export function buildClarifyPressure(
  projectRoot: string,
  cases: PressureEvidenceCase[],
): ClarifyPressureSummary {
  const repeatedTasks = buildRepeatedTasks(cases);
  const repeatedSources = buildRepeatedSources(cases);
  const repeatedTargets = buildRepeatedTargets(cases);
  const recentCluster = buildRecentCluster(cases);
  const agentBreakdown = buildAgentBreakdown(cases);
  const pressureTrajectories = buildPressureTrajectories(cases);
  const recurringReasons = buildRecurringReasons(cases, (item) => item.question ?? item.summary);
  const artifactCoverage = buildPressureArtifactCoverage(cases);
  const metadataCoverage = buildPressureMetadataCoverage(cases);
  const expectedClarifyFollowUpRunIds = buildExpectedClarifyFollowUpRunIds(cases);
  const coverageGapRuns = buildCoverageGapRuns(projectRoot, cases, (item) =>
    getClarifyMissingArtifacts(item, expectedClarifyFollowUpRunIds),
  );
  const missingArtifactBreakdown = buildMissingArtifactBreakdown(coverageGapRuns);
  const inspectionQueue = buildClarifyInspectionQueue(projectRoot, cases, coverageGapRuns);

  return clarifyPressureSummarySchema.parse({
    totalCases: cases.length,
    needsClarificationCases: cases.filter((item) => item.kind === "clarify-needed").length,
    externalResearchRequiredCases: cases.filter(
      (item) => item.kind === "external-research-required",
    ).length,
    artifactCoverage,
    metadataCoverage,
    recentCluster,
    agentBreakdown,
    repeatedTasks,
    repeatedSources,
    repeatedTargets,
    pressureTrajectories,
    recurringReasons,
    coverageGapRuns,
    missingArtifactBreakdown,
    inspectionQueue,
    coverageBlindSpots: buildClarifyCoverageBlindSpots(cases, artifactCoverage),
    promotionSignal: buildClarifyPromotionSignal(
      cases,
      agentBreakdown,
      repeatedTasks,
      repeatedSources,
      repeatedTargets,
      pressureTrajectories,
      recurringReasons,
    ),
    cases,
  });
}

export function buildFinalistSelectionPressure(
  projectRoot: string,
  cases: PressureEvidenceCase[],
): FinalistSelectionPressureSummary {
  const repeatedTasks = buildRepeatedTasks(cases);
  const repeatedSources = buildRepeatedSources(cases);
  const repeatedTargets = buildRepeatedTargets(cases);
  const repeatedStrategySets = buildRepeatedStrategySets(cases);
  const repeatedJudgingCriteriaSets = buildRepeatedJudgingCriteriaSets(cases);
  const recentCluster = buildRecentCluster(cases);
  const agentBreakdown = buildAgentBreakdown(cases);
  const pressureTrajectories = buildPressureTrajectories(cases);
  const recurringReasons = buildRecurringReasons(cases, (item) => item.summary);
  const artifactCoverage = buildPressureArtifactCoverage(cases);
  const metadataCoverage = buildPressureMetadataCoverage(cases);
  const coverageGapRuns = buildCoverageGapRuns(projectRoot, cases, getFinalistMissingArtifacts);
  const missingArtifactBreakdown = buildMissingArtifactBreakdown(coverageGapRuns);
  const inspectionQueue = buildFinalistInspectionQueue(projectRoot, cases, coverageGapRuns);

  return finalistSelectionPressureSummarySchema.parse({
    totalCases: cases.length,
    finalistsWithoutRecommendationCases: cases.filter(
      (item) => item.kind === "finalists-without-recommendation",
    ).length,
    judgeAbstainCases: cases.filter((item) => item.kind === "judge-abstain").length,
    manualCrowningCases: cases.filter((item) => item.kind === "manual-crowning-handoff").length,
    lowConfidenceRecommendationCases: cases.filter(
      (item) => item.kind === "low-confidence-recommendation",
    ).length,
    secondOpinionDisagreementCases: cases.filter(
      (item) => item.kind === "second-opinion-disagreement",
    ).length,
    artifactCoverage,
    metadataCoverage,
    recentCluster,
    agentBreakdown,
    repeatedTasks,
    repeatedSources,
    repeatedTargets,
    repeatedStrategySets,
    repeatedJudgingCriteriaSets,
    pressureTrajectories,
    recurringReasons,
    coverageGapRuns,
    missingArtifactBreakdown,
    inspectionQueue,
    coverageBlindSpots: buildFinalistCoverageBlindSpots(cases),
    promotionSignal: buildFinalistPromotionSignal(
      cases,
      agentBreakdown,
      repeatedTasks,
      repeatedSources,
      repeatedTargets,
      repeatedStrategySets,
      repeatedJudgingCriteriaSets,
      pressureTrajectories,
      recurringReasons,
    ),
    cases,
  });
}
