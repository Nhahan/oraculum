import type { z } from "zod";

export {
  consultationClarifyFollowUpSchema,
  consultationOutcomeSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationPreflightSchema,
  consultationResearchBriefSchema,
} from "./schema-parts/consultation.js";
export {
  candidateManifestSchema,
  roundManifestSchema,
  runRecommendationSchema,
} from "./schema-parts/execution.js";
export { exportPlanSchema, latestRunStateSchema } from "./schema-parts/export.js";
export { runManifestSchema } from "./schema-parts/manifest.js";
export {
  candidateScorecardArtifactCoherenceSchema,
  candidateScorecardReversibilitySchema,
  candidateScorecardSchema,
  candidateScorecardStageResultSchema,
  candidateScorecardStageStatusSchema,
  candidateScorecardWorkstreamCoverageStatusSchema,
  consultationPlanArtifactSchema,
  consultationPlanModeSchema,
  consultationPlanRepairPolicySchema,
  consultationPlanRepoBasisSchema,
  consultationPlanRoundSchema,
  consultationPlanScorecardDefinitionSchema,
  consultationPlanStageSchema,
  consultationPlanStrategySchema,
  consultationPlanWorkstreamSchema,
  finalistScorecardBundleSchema,
  finalistScorecardSchema,
} from "./schema-parts/plan.js";
export { savedConsultationStatusSchema } from "./schema-parts/saved-status.js";
export {
  candidateStatusSchema,
  clarifyPressureKindSchema,
  clarifyScopeKeyTypeSchema,
  consultationJudgingBasisKindSchema,
  consultationNextActionSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  exportMaterializationModeSchema,
  exportModeSchema,
  optionalNonEmptyStringSchema,
  reportBundleSchema,
  roundExecutionStatusSchema,
  runStatusSchema,
  workspaceModeSchema,
} from "./schema-parts/shared.js";

export type CandidateManifest = z.infer<
  typeof import("./schema-parts/execution.js").candidateManifestSchema
>;
export type RunManifest = z.infer<typeof import("./schema-parts/manifest.js").runManifestSchema>;
export type RunRound = z.infer<typeof import("./schema-parts/execution.js").roundManifestSchema>;
export type RunRecommendation = z.infer<
  typeof import("./schema-parts/execution.js").runRecommendationSchema
>;
export type ConsultationOutcome = z.infer<
  typeof import("./schema-parts/consultation.js").consultationOutcomeSchema
>;
export type ConsultationPreflight = z.infer<
  typeof import("./schema-parts/consultation.js").consultationPreflightSchema
>;
export type ConsultationClarifyFollowUp = z.infer<
  typeof import("./schema-parts/consultation.js").consultationClarifyFollowUpSchema
>;
export type ConsultationPreflightReadinessArtifact = z.infer<
  typeof import("./schema-parts/consultation.js").consultationPreflightReadinessArtifactSchema
>;
export type ConsultationResearchBrief = z.infer<
  typeof import("./schema-parts/consultation.js").consultationResearchBriefSchema
>;
export type ConsultationPlanArtifact = z.infer<
  typeof import("./schema-parts/plan.js").consultationPlanArtifactSchema
>;
export type ConsultationPlanWorkstream = z.infer<
  typeof import("./schema-parts/plan.js").consultationPlanWorkstreamSchema
>;
export type ConsultationPlanStage = z.infer<
  typeof import("./schema-parts/plan.js").consultationPlanStageSchema
>;
export type CandidateScorecardStageResult = z.infer<
  typeof import("./schema-parts/plan.js").candidateScorecardStageResultSchema
>;
export type CandidateScorecard = z.infer<
  typeof import("./schema-parts/plan.js").candidateScorecardSchema
>;
export type FinalistScorecard = z.infer<
  typeof import("./schema-parts/plan.js").finalistScorecardSchema
>;
export type FinalistScorecardBundle = z.infer<
  typeof import("./schema-parts/plan.js").finalistScorecardBundleSchema
>;
export type SavedConsultationStatus = z.infer<
  typeof import("./schema-parts/saved-status.js").savedConsultationStatusSchema
>;
export type ConsultationNextAction = z.infer<
  typeof import("./schema-parts/shared.js").consultationNextActionSchema
>;
export type ExportPlan = z.infer<typeof import("./schema-parts/export.js").exportPlanSchema>;
export type LatestRunState = z.infer<
  typeof import("./schema-parts/export.js").latestRunStateSchema
>;
export type WorkspaceMode = z.infer<typeof import("./schema-parts/shared.js").workspaceModeSchema>;
export type ExportMode = z.infer<typeof import("./schema-parts/shared.js").exportModeSchema>;
export type ExportMaterializationMode = z.infer<
  typeof import("./schema-parts/shared.js").exportMaterializationModeSchema
>;
