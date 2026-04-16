import { z } from "zod";

import { adapterSchema } from "../../domain/config.js";
import { decisionConfidenceSchema } from "../../domain/profile.js";
import {
  consultationOutcomeTypeSchema,
  consultationValidationPostureSchema,
} from "../../domain/run.js";
import {
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
  taskSourceKindSchema,
} from "../../domain/task.js";

export const pressureEvidenceCaseKindSchema = z.enum([
  "clarify-needed",
  "external-research-required",
  "finalists-without-recommendation",
  "judge-abstain",
  "manual-crowning-handoff",
  "low-confidence-recommendation",
  "second-opinion-disagreement",
]);

export const pressureEvidenceCaseSchema = z.object({
  kind: pressureEvidenceCaseKindSchema,
  runId: z.string().min(1),
  consultationPath: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  outcomeType: consultationOutcomeTypeSchema,
  outcomeSummary: z.string().min(1),
  validationPosture: consultationValidationPostureSchema,
  researchBasisStatus: taskResearchBasisStatusSchema,
  researchConflictHandling: taskResearchConflictHandlingSchema.optional(),
  researchRerunRecommended: z.boolean(),
  manualReviewRecommended: z.boolean(),
  preflightFallbackObserved: z.boolean().default(false),
  summary: z.string().min(1),
  supportingEvidence: z.array(z.string().min(1)).default([]),
  blockingEvidence: z.array(z.string().min(1)).default([]),
  artifactPaths: z
    .object({
      preflightReadinessPath: z.string().min(1).optional(),
      clarifyFollowUpPath: z.string().min(1).optional(),
      researchBriefPath: z.string().min(1).optional(),
      failureAnalysisPath: z.string().min(1).optional(),
      winnerSelectionPath: z.string().min(1).optional(),
      secondOpinionWinnerSelectionPath: z.string().min(1).optional(),
      comparisonJsonPath: z.string().min(1).optional(),
      comparisonMarkdownPath: z.string().min(1).optional(),
    })
    .default({}),
  question: z.string().min(1).optional(),
  candidateIds: z.array(z.string().min(1)).default([]),
  candidateStrategyLabels: z.array(z.string().min(1)).default([]),
  judgingCriteria: z.array(z.string().min(1)).min(1).max(5).optional(),
  confidence: decisionConfidenceSchema.optional(),
});

export const pressureRepeatedTaskSchema = z.object({
  taskTitle: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureRepeatedSourceSchema = z.object({
  taskSourceKind: taskSourceKindSchema,
  taskSourceKinds: z.array(taskSourceKindSchema).min(1),
  taskSourcePath: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureRecurringReasonSchema = z.object({
  label: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureRepeatedTargetSchema = z.object({
  targetArtifactPath: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureRepeatedStrategySetSchema = z.object({
  strategyLabels: z.array(z.string().min(1)).min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureRepeatedJudgingCriteriaSetSchema = z.object({
  judgingCriteria: z.array(z.string().min(1)).min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  taskTitles: z.array(z.string().min(1)).min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressurePromotionSignalSchema = z.object({
  shouldPromote: z.boolean(),
  distinctRunCount: z.number().int().min(0),
  reasons: z.array(z.string().min(1)).default([]),
});

export const pressureMissingArtifactKindSchema = z.enum([
  "preflight-readiness",
  "clarify-follow-up",
  "research-brief",
  "winner-selection",
  "winner-selection-second-opinion",
  "comparison-report",
  "failure-analysis",
]);

export const pressureAgentBreakdownSchema = z.object({
  agent: adapterSchema,
  caseCount: z.number().int().min(1),
  consultationCount: z.number().int().min(1),
});

export const pressureTrajectoryRunSchema = z.object({
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
});

export const pressureTrajectorySchema = z.object({
  keyType: z.enum(["target-artifact", "task-source"]),
  key: z.string().min(1),
  occurrenceCount: z.number().int().min(2),
  latestRunId: z.string().min(1),
  latestOpenedAt: z.string().min(1),
  daySpanDays: z.number().int().min(0),
  agents: z.array(adapterSchema).min(1),
  distinctKinds: z.array(pressureEvidenceCaseKindSchema).min(1),
  containsEscalation: z.boolean(),
  runs: z.array(pressureTrajectoryRunSchema).min(2),
});

export const pressureInspectionItemSchema = z.object({
  artifactKind: z.enum([
    "preflight-readiness",
    "clarify-follow-up",
    "research-brief",
    "winner-selection",
    "winner-selection-second-opinion",
    "comparison-json",
    "comparison-markdown",
    "failure-analysis",
    "run-manifest",
  ]),
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  reason: z.string().min(1),
  path: z.string().min(1),
});

export const pressureCoverageGapRunSchema = z.object({
  runId: z.string().min(1),
  openedAt: z.string().min(1),
  agent: adapterSchema,
  taskTitle: z.string().min(1),
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  targetArtifactPath: z.string().min(1).optional(),
  consultationPath: z.string().min(1),
  manifestPath: z.string().min(1),
  kinds: z.array(pressureEvidenceCaseKindSchema).min(1),
  missingArtifactKinds: z.array(pressureMissingArtifactKindSchema).min(1),
});

export const pressureMissingArtifactBreakdownSchema = z.object({
  artifactKind: pressureMissingArtifactKindSchema,
  consultationCount: z.number().int().min(1),
});

export const pressureRecentClusterSchema = z.object({
  windowDays: z.number().int().min(1),
  recentRunCount: z.number().int().min(0),
  latestRunId: z.string().min(1).optional(),
  latestOpenedAt: z.string().min(1).optional(),
});

export const pressureArtifactCoverageSchema = z.object({
  consultationsWithPreflightReadiness: z.number().int().min(0),
  consultationsWithPreflightFallback: z.number().int().min(0),
  consultationsWithClarifyFollowUp: z.number().int().min(0),
  consultationsWithComparisonReport: z.number().int().min(0),
  consultationsWithWinnerSelection: z.number().int().min(0),
  consultationsWithFailureAnalysis: z.number().int().min(0),
  consultationsWithResearchBrief: z.number().int().min(0),
  consultationsWithManualReviewRecommendation: z.number().int().min(0),
});

export const pressureMetadataCoverageSchema = z.object({
  consultationCount: z.number().int().min(0),
  consultationsWithValidationGaps: z.number().int().min(0),
  consultationsWithCurrentResearchBasis: z.number().int().min(0),
  consultationsWithStaleResearchBasis: z.number().int().min(0),
  consultationsWithUnknownResearchBasis: z.number().int().min(0),
  consultationsWithResearchConflicts: z.number().int().min(0),
  consultationsWithResearchRerunRecommended: z.number().int().min(0),
  consultationsWithJudgingCriteria: z.number().int().min(0),
});

export const pressureLaneArtifactCoverageSchema = z.object({
  caseCount: z.number().int().min(0),
  casesWithTargetArtifact: z.number().int().min(0),
  casesWithPreflightReadiness: z.number().int().min(0),
  casesWithPreflightFallback: z.number().int().min(0),
  casesWithClarifyFollowUp: z.number().int().min(0),
  casesWithComparisonReport: z.number().int().min(0),
  casesWithWinnerSelection: z.number().int().min(0),
  casesWithFailureAnalysis: z.number().int().min(0),
  casesWithResearchBrief: z.number().int().min(0),
  casesWithManualReviewRecommendation: z.number().int().min(0),
});

export const clarifyPressureSummarySchema = z.object({
  totalCases: z.number().int().min(0),
  needsClarificationCases: z.number().int().min(0),
  externalResearchRequiredCases: z.number().int().min(0),
  artifactCoverage: pressureLaneArtifactCoverageSchema,
  metadataCoverage: pressureMetadataCoverageSchema,
  recentCluster: pressureRecentClusterSchema,
  agentBreakdown: z.array(pressureAgentBreakdownSchema).default([]),
  repeatedTasks: z.array(pressureRepeatedTaskSchema).default([]),
  repeatedSources: z.array(pressureRepeatedSourceSchema).default([]),
  repeatedTargets: z.array(pressureRepeatedTargetSchema).default([]),
  pressureTrajectories: z.array(pressureTrajectorySchema).default([]),
  recurringReasons: z.array(pressureRecurringReasonSchema).default([]),
  coverageGapRuns: z.array(pressureCoverageGapRunSchema).default([]),
  missingArtifactBreakdown: z.array(pressureMissingArtifactBreakdownSchema).default([]),
  inspectionQueue: z.array(pressureInspectionItemSchema).default([]),
  coverageBlindSpots: z.array(z.string().min(1)).default([]),
  promotionSignal: pressurePromotionSignalSchema,
  cases: z.array(pressureEvidenceCaseSchema).default([]),
});

export const finalistSelectionPressureSummarySchema = z.object({
  totalCases: z.number().int().min(0),
  finalistsWithoutRecommendationCases: z.number().int().min(0),
  judgeAbstainCases: z.number().int().min(0),
  manualCrowningCases: z.number().int().min(0),
  lowConfidenceRecommendationCases: z.number().int().min(0),
  secondOpinionDisagreementCases: z.number().int().min(0),
  artifactCoverage: pressureLaneArtifactCoverageSchema,
  metadataCoverage: pressureMetadataCoverageSchema,
  recentCluster: pressureRecentClusterSchema,
  agentBreakdown: z.array(pressureAgentBreakdownSchema).default([]),
  repeatedTasks: z.array(pressureRepeatedTaskSchema).default([]),
  repeatedSources: z.array(pressureRepeatedSourceSchema).default([]),
  repeatedTargets: z.array(pressureRepeatedTargetSchema).default([]),
  repeatedStrategySets: z.array(pressureRepeatedStrategySetSchema).default([]),
  repeatedJudgingCriteriaSets: z.array(pressureRepeatedJudgingCriteriaSetSchema).default([]),
  pressureTrajectories: z.array(pressureTrajectorySchema).default([]),
  recurringReasons: z.array(pressureRecurringReasonSchema).default([]),
  coverageGapRuns: z.array(pressureCoverageGapRunSchema).default([]),
  missingArtifactBreakdown: z.array(pressureMissingArtifactBreakdownSchema).default([]),
  inspectionQueue: z.array(pressureInspectionItemSchema).default([]),
  coverageBlindSpots: z.array(z.string().min(1)).default([]),
  promotionSignal: pressurePromotionSignalSchema,
  cases: z.array(pressureEvidenceCaseSchema).default([]),
});

export const pressureEvidenceReportSchema = z.object({
  generatedAt: z.string().min(1),
  projectRoot: z.string().min(1),
  consultationCount: z.number().int().min(0),
  artifactCoverage: pressureArtifactCoverageSchema,
  clarifyPressure: clarifyPressureSummarySchema,
  finalistSelectionPressure: finalistSelectionPressureSummarySchema,
});

export type PressureAgentBreakdown = z.infer<typeof pressureAgentBreakdownSchema>;
export type PressureArtifactCoverage = z.infer<typeof pressureArtifactCoverageSchema>;
export type ClarifyPressureSummary = z.infer<typeof clarifyPressureSummarySchema>;
export type PressureCoverageGapRun = z.infer<typeof pressureCoverageGapRunSchema>;
export type PressureEvidenceCase = z.infer<typeof pressureEvidenceCaseSchema>;
export type PressureEvidenceCaseKind = z.infer<typeof pressureEvidenceCaseKindSchema>;
export type PressureEvidenceReport = z.infer<typeof pressureEvidenceReportSchema>;
export type FinalistSelectionPressureSummary = z.infer<
  typeof finalistSelectionPressureSummarySchema
>;
export type PressureInspectionItem = z.infer<typeof pressureInspectionItemSchema>;
export type PressureMissingArtifactBreakdown = z.infer<
  typeof pressureMissingArtifactBreakdownSchema
>;
export type PressureMissingArtifactKind = z.infer<typeof pressureMissingArtifactKindSchema>;
export type PressureLaneArtifactCoverage = z.infer<typeof pressureLaneArtifactCoverageSchema>;
export type PressureMetadataCoverage = z.infer<typeof pressureMetadataCoverageSchema>;
export type PressureTrajectory = z.infer<typeof pressureTrajectorySchema>;
export type PressureTrajectoryRun = z.infer<typeof pressureTrajectoryRunSchema>;
export type PressurePromotionSignal = z.infer<typeof pressurePromotionSignalSchema>;
export type PressureRecentCluster = z.infer<typeof pressureRecentClusterSchema>;
export type PressureRecurringReason = z.infer<typeof pressureRecurringReasonSchema>;
export type PressureRepeatedJudgingCriteriaSet = z.infer<
  typeof pressureRepeatedJudgingCriteriaSetSchema
>;
export type PressureRepeatedSource = z.infer<typeof pressureRepeatedSourceSchema>;
export type PressureRepeatedStrategySet = z.infer<typeof pressureRepeatedStrategySetSchema>;
export type PressureRepeatedTarget = z.infer<typeof pressureRepeatedTargetSchema>;
export type PressureRepeatedTask = z.infer<typeof pressureRepeatedTaskSchema>;
