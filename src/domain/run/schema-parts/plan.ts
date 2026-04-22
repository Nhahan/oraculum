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
});
