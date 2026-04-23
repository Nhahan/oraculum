import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";
import { roundIdSchema } from "../../config.js";
import { consultationProfileSelectionSchema } from "../../profile.js";
import { projectRelativePathSchema } from "../../project-path.js";
import { materializedTaskPacketSchema } from "../../task.js";
import { consultationPreflightSchema } from "./consultation.js";
import { consultationPreflightDecisionSchema } from "./shared.js";

export const consultationPlanStrategySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export const consultationPlanRoundSchema = z.object({
  id: roundIdSchema,
  label: z.string().min(1),
});
export const consultationPlanModeSchema = z.enum(["standard", "complex", "deliberate"]);
export const consultationPlanRepoBasisSchema = z.object({
  projectRoot: z.string().min(1),
  signalFingerprint: z.string().min(1),
  availableOracleIds: z.array(artifactPathSegmentSchema).default([]),
  createdFromProfileId: z.string().min(1).optional(),
  createdFromPreflightDecision: consultationPreflightDecisionSchema.optional(),
});
export const consultationPlanReadinessStatusSchema = z.enum([
  "clear",
  "issues",
  "needs-clarification",
  "blocked",
]);
export const consultationPlanReviewArtifactStatusSchema = z.enum(["clear", "issues", "blocked"]);
export const consultationPlanReviewStatusSchema = z.enum(["not-run", "clear", "issues", "blocked"]);
export const planningDepthSchema = z.enum(["skip-interview", "interview", "deep-interview"]);
export const planningReadinessSchema = z.enum(["ready", "needs-interview", "blocked"]);
export const planningConsensusReviewDepthSchema = z.enum(["standard", "deep"]);
export const planningContinuationClassificationSchema = z.enum(["new-task", "continuation"]);
export const planConsensusReviewVerdictSchema = z.enum(["approve", "revise", "reject"]);
export const consultationPlanReadinessSchema = z.object({
  runId: artifactPathSegmentSchema,
  status: consultationPlanReadinessStatusSchema,
  readyForConsult: z.boolean(),
  blockers: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  staleBasis: z.boolean(),
  missingOracleIds: z.array(artifactPathSegmentSchema).default([]),
  unresolvedQuestions: z.array(z.string().min(1)).default([]),
  reviewStatus: consultationPlanReviewStatusSchema,
  nextAction: z.string().min(1),
});
export const consultationPlanReviewSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  status: consultationPlanReviewArtifactStatusSchema,
  summary: z.string().min(1),
  blockers: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  riskFindings: z.array(z.string().min(1)).default([]),
  invariantFindings: z.array(z.string().min(1)).default([]),
  crownGateFindings: z.array(z.string().min(1)).default([]),
  repairPolicyFindings: z.array(z.string().min(1)).default([]),
  scorecardFindings: z.array(z.string().min(1)).default([]),
  nextAction: z.string().min(1),
});
export const consultationPlanWorkstreamSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  goal: z.string().min(1),
  targetArtifacts: z.array(projectRelativePathSchema).default([]),
  requiredChangedPaths: z.array(projectRelativePathSchema).default([]),
  protectedPaths: z.array(projectRelativePathSchema).default([]),
  oracleIds: z.array(artifactPathSegmentSchema).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  disqualifiers: z.array(z.string().min(1)).default([]),
});
export const consultationPlanStageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([]),
  workstreamIds: z.array(z.string().min(1)).default([]),
  roundIds: z.array(roundIdSchema).default([]),
  entryCriteria: z.array(z.string().min(1)).default([]),
  exitCriteria: z.array(z.string().min(1)).default([]),
});
export const consultationPlanScorecardDefinitionSchema = z.object({
  dimensions: z.array(z.string().min(1)).default([]),
  abstentionTriggers: z.array(z.string().min(1)).default([]),
});
export const consultationPlanRepairPolicySchema = z.object({
  maxAttemptsPerStage: z.number().int().min(0).default(0),
  immediateElimination: z.array(z.string().min(1)).default([]),
  repairable: z.array(z.string().min(1)).default([]),
  preferAbstainOverRetry: z.array(z.string().min(1)).default([]),
});
export const planningOntologySnapshotSchema = z.object({
  goals: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([]),
  nonGoals: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
});
export const planningDepthArtifactSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  depth: planningDepthSchema,
  readiness: planningReadinessSchema,
  confidence: z.string().min(1),
  summary: z.string().min(1),
  reasons: z.array(z.string().min(1)).default([]),
  estimatedInterviewRounds: z.number().int().min(0).max(8),
  consensusReviewDepth: planningConsensusReviewDepthSchema,
  maxInterviewRounds: z.number().int().min(0),
  maxConsensusRevisions: z.number().int().min(0),
});
export const planningInterviewRoundSchema = z.object({
  round: z.number().int().min(1),
  question: z.string().min(1),
  perspective: z.string().min(1),
  expectedAnswerShape: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  clarityScore: z.number().min(0).max(1).optional(),
  weakestDimension: z.string().min(1).optional(),
  readyForSpec: z.boolean().optional(),
  assumptions: z.array(z.string().min(1)).default([]),
  ontologySnapshot: planningOntologySnapshotSchema.optional(),
});
export const planningInterviewArtifactSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: z.enum(["needs-clarification", "ready-for-spec", "blocked"]),
  taskId: z.string().min(1),
  sourceRunId: artifactPathSegmentSchema.optional(),
  depth: planningDepthSchema,
  rounds: z.array(planningInterviewRoundSchema).default([]),
  clarityScore: z.number().min(0).max(1).optional(),
  weakestDimension: z.string().min(1).optional(),
  assumptions: z.array(z.string().min(1)).default([]),
  ontologySnapshots: z.array(planningOntologySnapshotSchema).default([]),
  nextQuestion: z.string().min(1).optional(),
});
export const planningSpecArtifactSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  taskId: z.string().min(1),
  goal: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  nonGoals: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  assumptionsResolved: z.array(z.string().min(1)).default([]),
  assumptionLedger: z.array(z.string().min(1)).default([]),
  repoEvidence: z.array(z.string().min(1)).default([]),
  openRisks: z.array(z.string().min(1)).default([]),
});
export const planConsensusOptionSchema = z.object({
  name: z.string().min(1),
  rationale: z.string().min(1),
});
export const planConsensusDraftSchema = z.object({
  summary: z.string().min(1),
  principles: z.array(z.string().min(1)).default([]),
  decisionDrivers: z.array(z.string().min(1)).default([]),
  viableOptions: z.array(planConsensusOptionSchema).default([]),
  selectedOption: planConsensusOptionSchema,
  rejectedAlternatives: z.array(planConsensusOptionSchema).default([]),
  plannedJudgingCriteria: z.array(z.string().min(1)).default([]),
  crownGates: z.array(z.string().min(1)).default([]),
  requiredChangedPaths: z.array(projectRelativePathSchema).default([]),
  protectedPaths: z.array(projectRelativePathSchema).default([]),
  workstreams: z.array(consultationPlanWorkstreamSchema).default([]),
  stagePlan: z.array(consultationPlanStageSchema).default([]),
  scorecardDefinition: consultationPlanScorecardDefinitionSchema.optional(),
  repairPolicy: consultationPlanRepairPolicySchema.optional(),
  assumptionLedger: z.array(z.string().min(1)).default([]),
  premortem: z.array(z.string().min(1)).default([]),
  expandedTestPlan: z.array(z.string().min(1)).default([]),
});
export const planConsensusReviewSchema = z.object({
  reviewer: z.enum(["architect", "critic"]),
  verdict: planConsensusReviewVerdictSchema,
  summary: z.string().min(1),
  requiredChanges: z.array(z.string().min(1)).default([]),
  tradeoffs: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
});
export const planConsensusRevisionSchema = z.object({
  revision: z.number().int().min(1),
  summary: z.string().min(1),
  architectReview: planConsensusReviewSchema.optional(),
  criticReview: planConsensusReviewSchema.optional(),
});
export const planConsensusArtifactSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  approved: z.boolean(),
  maxRevisions: z.number().int().min(0),
  principles: z.array(z.string().min(1)).default([]),
  decisionDrivers: z.array(z.string().min(1)).default([]),
  viableOptions: z.array(planConsensusOptionSchema).default([]),
  selectedOption: planConsensusOptionSchema,
  rejectedAlternatives: z.array(planConsensusOptionSchema).default([]),
  architectAntithesis: z.array(z.string().min(1)).default([]),
  criticVerdicts: z.array(planConsensusReviewSchema).default([]),
  revisionHistory: z.array(planConsensusRevisionSchema).default([]),
  finalDraft: planConsensusDraftSchema,
});
export const candidateScorecardWorkstreamCoverageStatusSchema = z.enum([
  "covered",
  "missing",
  "blocked",
]);
export const candidateScorecardStageStatusSchema = z.enum(["pass", "repairable", "fail", "skip"]);
export const candidateScorecardArtifactCoherenceSchema = z.enum(["unknown", "weak", "strong"]);
export const candidateScorecardReversibilitySchema = z.enum(["unknown", "unclear", "reversible"]);
export const candidateScorecardStageResultSchema = z.object({
  stageId: z.string().min(1),
  status: candidateScorecardStageStatusSchema,
  workstreamCoverage: z
    .record(z.string().min(1), candidateScorecardWorkstreamCoverageStatusSchema)
    .default({}),
  violations: z.array(z.string().min(1)).default([]),
  unresolvedRisks: z.array(z.string().min(1)).default([]),
});
export const candidateScorecardSchema = z.object({
  candidateId: artifactPathSegmentSchema,
  mode: consultationPlanModeSchema,
  stageResults: z.array(candidateScorecardStageResultSchema).default([]),
  violations: z.array(z.string().min(1)).default([]),
  unresolvedRisks: z.array(z.string().min(1)).default([]),
  artifactCoherence: candidateScorecardArtifactCoherenceSchema.default("unknown"),
  reversibility: candidateScorecardReversibilitySchema.default("unknown"),
});
export const finalistScorecardSchema = candidateScorecardSchema.extend({
  strategyLabel: z.string().min(1),
});
export const finalistScorecardBundleSchema = z.object({
  runId: artifactPathSegmentSchema,
  generatedAt: z.string().min(1),
  finalists: z.array(finalistScorecardSchema).default([]),
});
export const consultationPlanArtifactSchema = z.object({
  runId: artifactPathSegmentSchema,
  createdAt: z.string().min(1),
  mode: consultationPlanModeSchema.default("standard"),
  readyForConsult: z.boolean(),
  recommendedNextAction: z.string().min(1),
  intendedResult: z.string().min(1),
  decisionDrivers: z.array(z.string().min(1)).default([]),
  plannedJudgingCriteria: z.array(z.string().min(1)).default([]),
  crownGates: z.array(z.string().min(1)).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
  task: materializedTaskPacketSchema,
  preflight: consultationPreflightSchema.optional(),
  profileSelection: consultationProfileSelectionSchema.optional(),
  repoBasis: consultationPlanRepoBasisSchema.default({
    projectRoot: "<unknown>",
    signalFingerprint: "unknown",
    availableOracleIds: [],
  }),
  candidateCount: z.number().int().min(0),
  plannedStrategies: z.array(consultationPlanStrategySchema).default([]),
  oracleIds: z.array(artifactPathSegmentSchema).default([]),
  requiredChangedPaths: z.array(projectRelativePathSchema).default([]),
  protectedPaths: z.array(projectRelativePathSchema).default([]),
  roundOrder: z.array(consultationPlanRoundSchema).default([]),
  workstreams: z.array(consultationPlanWorkstreamSchema).default([]),
  stagePlan: z.array(consultationPlanStageSchema).default([]),
  scorecardDefinition: consultationPlanScorecardDefinitionSchema.default({
    dimensions: [],
    abstentionTriggers: [],
  }),
  repairPolicy: consultationPlanRepairPolicySchema.default({
    maxAttemptsPerStage: 0,
    immediateElimination: [],
    repairable: [],
    preferAbstainOverRetry: [],
  }),
  planningSpecPath: projectRelativePathSchema.optional(),
  planningInterviewPath: projectRelativePathSchema.optional(),
  planConsensusPath: projectRelativePathSchema.optional(),
  clarityGate: z
    .object({
      status: z.enum(["clear", "needs-clarification", "blocked"]),
      score: z.number().min(0).max(1).optional(),
      weakestDimension: z.string().min(1).optional(),
      summary: z.string().min(1),
    })
    .optional(),
  selectedApproach: z.string().min(1).optional(),
  rejectedApproaches: z.array(z.string().min(1)).default([]),
  assumptionLedger: z.array(z.string().min(1)).default([]),
  premortem: z.array(z.string().min(1)).default([]),
  expandedTestPlan: z.array(z.string().min(1)).default([]),
});
