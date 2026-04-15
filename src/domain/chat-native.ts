import { z } from "zod";

import { adapterSchema, secondOpinionJudgeTriggerSchema } from "./config.js";
import { decisionConfidenceSchema } from "./profile.js";
import {
  clarifyScopeKeyTypeSchema,
  consultationJudgingBasisKindSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  exportMaterializationModeSchema,
  exportModeSchema,
  exportPlanSchema,
  getExportMaterializationMode,
  optionalNonEmptyStringSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "./run.js";
import { stringArrayMembersEqual } from "./schema-compat.js";
import {
  deriveResearchConflictHandling,
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
  taskSourceKindSchema,
} from "./task.js";

function getBlockedReviewOutcomeType(
  decision: z.infer<typeof consultationPreflightDecisionSchema>,
): z.infer<typeof consultationOutcomeTypeSchema> | undefined {
  switch (decision) {
    case "needs-clarification":
      return "needs-clarification";
    case "external-research-required":
      return "external-research-required";
    case "abstain":
      return "abstained-before-execution";
    case "proceed":
      return undefined;
  }
}

export const commandPrefixSchema = z.literal("orc");

export const mcpToolIdSchema = z.enum([
  "oraculum_consult",
  "oraculum_plan",
  "oraculum_draft",
  "oraculum_verdict",
  "oraculum_verdict_archive",
  "oraculum_crown",
  "oraculum_init",
  "oraculum_setup_status",
]);

export const schemaReferenceSchema = z.string().min(1);

export const toolBindingSchema = z.object({
  kind: z.enum(["existing-service", "existing-command", "new-adapter-layer"]),
  module: z.string().min(1),
  symbol: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const toolMetadataSchema = z.object({
  id: mcpToolIdSchema,
  purpose: z.string().min(1),
  requestShape: schemaReferenceSchema,
  responseShape: schemaReferenceSchema,
  bindings: z.array(toolBindingSchema).min(1),
  machineReadableArtifacts: z.array(z.string().min(1)).default([]),
});

export const commandArgumentKindSchema = z.enum(["string", "integer", "boolean"]);

export const commandArgumentSchema = z.object({
  name: z.string().min(1),
  kind: commandArgumentKindSchema,
  description: z.string().min(1),
  required: z.boolean().default(false),
  positional: z.boolean().default(false),
  option: z.string().min(1).optional(),
});

export const commandManifestEntrySchema = z.object({
  id: z.string().min(1),
  prefix: commandPrefixSchema,
  path: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  mcpTool: mcpToolIdSchema,
  requestShape: schemaReferenceSchema,
  responseShape: schemaReferenceSchema,
  arguments: z.array(commandArgumentSchema).default([]),
  examples: z.array(z.string().min(1)).min(1),
  hostAdditions: z
    .object({
      "claude-code": z.record(z.string(), z.string()).optional(),
      codex: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});

export const consultToolRequestSchema = z.object({
  cwd: z.string().min(1),
  taskInput: z.string().min(1),
  agent: adapterSchema.optional(),
  candidates: z.number().int().min(1).max(16).optional(),
  timeoutMs: z.number().int().min(1).optional(),
});

export const consultationArtifactPathsSchema = z.object({
  consultationRoot: z.string().min(1),
  configPath: z.string().min(1).optional(),
  consultationPlanPath: z.string().min(1).optional(),
  consultationPlanMarkdownPath: z.string().min(1).optional(),
  preflightReadinessPath: z.string().min(1).optional(),
  clarifyFollowUpPath: z.string().min(1).optional(),
  researchBriefPath: z.string().min(1).optional(),
  failureAnalysisPath: z.string().min(1).optional(),
  profileSelectionPath: z.string().min(1).optional(),
  comparisonJsonPath: z.string().min(1).optional(),
  comparisonMarkdownPath: z.string().min(1).optional(),
  winnerSelectionPath: z.string().min(1).optional(),
  secondOpinionWinnerSelectionPath: z.string().min(1).optional(),
  crowningRecordPath: z.string().min(1).optional(),
});

export const projectInitializationResultSchema = z.object({
  projectRoot: z.string().min(1),
  configPath: z.string().min(1),
  createdPaths: z.array(z.string().min(1)),
});

export const consultToolResponseSchema = z.object({
  mode: z.literal("consult"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  initializedProject: projectInitializationResultSchema.optional(),
});

export const planToolRequestSchema = z.object({
  cwd: z.string().min(1),
  taskInput: z.string().min(1),
  agent: adapterSchema.optional(),
  candidates: z.number().int().min(1).max(16).optional(),
  timeoutMs: z.number().int().min(1).optional(),
});

export const planToolResponseSchema = z.object({
  mode: z.literal("plan"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  initializedProject: projectInitializationResultSchema.optional(),
});

export const draftToolRequestSchema = z.object({
  cwd: z.string().min(1),
  taskInput: z.string().min(1),
  agent: adapterSchema.optional(),
  candidates: z.number().int().min(1).max(16).optional(),
  timeoutMs: z.number().int().min(1).optional(),
});

export const draftToolResponseSchema = z.object({
  mode: z.literal("draft"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  initializedProject: projectInitializationResultSchema.optional(),
});

export const verdictToolRequestSchema = z.object({
  cwd: z.string().min(1),
  consultationId: z.string().min(1).optional(),
});

export const verdictReviewSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = { ...(value as Record<string, unknown>) };
    if (typeof payload.validationProfileId !== "string" && typeof payload.profileId === "string") {
      payload.validationProfileId = payload.profileId;
    }
    if (typeof payload.profileId !== "string" && typeof payload.validationProfileId === "string") {
      payload.profileId = payload.validationProfileId;
    }
    if (
      !Array.isArray(payload.validationGaps) &&
      Array.isArray(payload.profileMissingCapabilities)
    ) {
      payload.validationGaps = payload.profileMissingCapabilities;
    }
    if (
      !Array.isArray(payload.profileMissingCapabilities) &&
      Array.isArray(payload.validationGaps)
    ) {
      payload.profileMissingCapabilities = payload.validationGaps;
    }
    const hasPersistedResearchContext =
      (typeof payload.researchSignalCount === "number" && payload.researchSignalCount > 0) ||
      typeof payload.researchSignalFingerprint === "string" ||
      typeof payload.researchConfidence === "string" ||
      typeof payload.researchRerunInputPath === "string" ||
      typeof payload.researchSummary === "string" ||
      (typeof payload.researchSourceCount === "number" && payload.researchSourceCount > 0) ||
      (typeof payload.researchClaimCount === "number" && payload.researchClaimCount > 0) ||
      (typeof payload.researchVersionNoteCount === "number" &&
        payload.researchVersionNoteCount > 0) ||
      (typeof payload.researchConflictCount === "number" && payload.researchConflictCount > 0) ||
      payload.researchConflictsPresent === true ||
      typeof payload.researchConflictHandling === "string";
    if (typeof payload.researchConflictHandling !== "string" && hasPersistedResearchContext) {
      payload.researchConflictHandling = deriveResearchConflictHandling(
        payload.researchConflictsPresent === true ? ["persisted-conflict"] : [],
      );
    }
    if (typeof payload.researchBasisStatus !== "string") {
      payload.researchBasisStatus =
        payload.researchBasisDrift === true
          ? "stale"
          : hasPersistedResearchContext
            ? "current"
            : "unknown";
    }

    return payload;
  },
  z
    .object({
      outcomeType: consultationOutcomeTypeSchema,
      outcomeSummary: z.string().min(1).optional(),
      verificationLevel: consultationVerificationLevelSchema,
      validationPosture: consultationValidationPostureSchema,
      judgingBasisKind: consultationJudgingBasisKindSchema,
      judgingBasisSummary: z.string().min(1).optional(),
      taskSourceKind: taskSourceKindSchema,
      taskSourcePath: z.string().min(1),
      taskArtifactKind: z.string().min(1).optional(),
      targetArtifactPath: z.string().min(1).optional(),
      researchSummary: z.string().min(1).optional(),
      researchConfidence: decisionConfidenceSchema.optional(),
      researchBasisStatus: taskResearchBasisStatusSchema,
      researchConflictHandling: taskResearchConflictHandlingSchema.optional(),
      researchSignalCount: z.number().int().min(0),
      researchSignalFingerprint: z.string().min(1).optional(),
      researchBasisDrift: z.boolean().optional(),
      researchRerunRecommended: z.boolean(),
      researchRerunInputPath: z.string().min(1).optional(),
      researchSourceCount: z.number().int().min(0),
      researchClaimCount: z.number().int().min(0),
      researchVersionNoteCount: z.number().int().min(0),
      researchConflictCount: z.number().int().min(0),
      researchConflictsPresent: z.boolean(),
      taskOriginSourceKind: taskSourceKindSchema.optional(),
      taskOriginSourcePath: z.string().min(1).optional(),
      recommendedCandidateId: z.string().min(1).optional(),
      finalistIds: z.array(z.string().min(1)).default([]),
      strongestEvidence: z.array(z.string().min(1)).default([]),
      weakestEvidence: z.array(z.string().min(1)).default([]),
      judgingCriteria: z.array(z.string().min(1)).min(1).max(5).optional(),
      recommendationSummary: z.string().min(1).optional(),
      recommendationAbsenceReason: z.string().min(1).optional(),
      secondOpinionAdapter: adapterSchema.optional(),
      secondOpinionAgreement: z
        .enum([
          "agrees-select",
          "agrees-abstain",
          "disagrees-candidate",
          "disagrees-select-vs-abstain",
          "unavailable",
        ])
        .optional(),
      secondOpinionSummary: z.string().min(1).optional(),
      secondOpinionDecision: z.enum(["select", "abstain"]).optional(),
      secondOpinionCandidateId: z.string().min(1).optional(),
      secondOpinionConfidence: decisionConfidenceSchema.optional(),
      secondOpinionTriggerKinds: z.array(secondOpinionJudgeTriggerSchema).default([]),
      secondOpinionTriggerReasons: z.array(z.string().min(1)).default([]),
      manualReviewRecommended: z.boolean().default(false),
      manualCrowningCandidateIds: z.array(z.string().min(1)).default([]),
      manualCrowningReason: z.string().min(1).optional(),
      validationProfileId: z.string().min(1).optional(),
      validationSummary: z.string().min(1).optional(),
      validationSignals: z.array(z.string().min(1)).default([]),
      validationGaps: z.array(z.string().min(1)).default([]),
      profileId: z.string().min(1).optional(),
      profileMissingCapabilities: z.array(z.string().min(1)).optional(),
      preflightDecision: consultationPreflightDecisionSchema.optional(),
      researchPosture: consultationResearchPostureSchema,
      clarificationQuestion: z.string().min(1).optional(),
      researchQuestion: z.string().min(1).optional(),
      clarifyScopeKeyType: clarifyScopeKeyTypeSchema.optional(),
      clarifyScopeKey: z.string().min(1).optional(),
      clarifyRepeatedCaseCount: z.number().int().min(2).optional(),
      clarifyFollowUpQuestion: z.string().min(1).optional(),
      clarifyMissingResultContract: z.string().min(1).optional(),
      clarifyMissingJudgingBasis: z.string().min(1).optional(),
      artifactAvailability: z.object({
        preflightReadiness: z.boolean(),
        clarifyFollowUp: z.boolean().default(false),
        researchBrief: z.boolean(),
        failureAnalysis: z.boolean().default(false),
        profileSelection: z.boolean(),
        comparisonReport: z.boolean(),
        winnerSelection: z.boolean(),
        secondOpinionWinnerSelection: z.boolean().default(false),
        crowningRecord: z.boolean(),
      }),
      candidateStateCounts: z.record(z.string().min(1), z.number().int().min(0)),
    })
    .superRefine((value, context) => {
      const persistedFinalistCount =
        (value.candidateStateCounts.promoted ?? 0) + (value.candidateStateCounts.exported ?? 0);

      if (
        value.profileId &&
        value.validationProfileId &&
        value.profileId !== value.validationProfileId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profileId"],
          message:
            "profileId must match validationProfileId when both legacy and validation aliases are present.",
        });
      }
      if (
        value.profileMissingCapabilities &&
        !stringArrayMembersEqual(value.profileMissingCapabilities, value.validationGaps)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profileMissingCapabilities"],
          message:
            "profileMissingCapabilities must match validationGaps when both legacy and validation aliases are present.",
        });
      }

      if (
        value.outcomeSummary &&
        value.outcomeSummary !==
          describeConsultationOutcomeSummary({
            outcomeType: value.outcomeType,
            ...(value.taskArtifactKind ? { taskArtifactKind: value.taskArtifactKind } : {}),
            ...(value.targetArtifactPath ? { targetArtifactPath: value.targetArtifactPath } : {}),
          })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeSummary"],
          message: "outcomeSummary must match outcomeType and task artifact context when present.",
        });
      }

      if (
        value.judgingBasisSummary &&
        value.judgingBasisSummary !==
          describeConsultationJudgingBasisSummary(value.judgingBasisKind)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["judgingBasisSummary"],
          message: "judgingBasisSummary must match judgingBasisKind when present.",
        });
      }

      if (value.researchBasisStatus === "stale" && value.researchBasisDrift !== true) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["researchBasisStatus"],
          message: "researchBasisStatus stale requires researchBasisDrift to be true.",
        });
      }

      if (
        value.researchConflictHandling === "manual-review-required" &&
        !value.researchConflictsPresent
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["researchConflictHandling"],
          message:
            "researchConflictHandling manual-review-required requires researchConflictsPresent to be true.",
        });
      }

      if (
        value.researchConflictsPresent &&
        value.researchConflictHandling &&
        value.researchConflictHandling !== "manual-review-required"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["researchConflictHandling"],
          message:
            "researchConflictHandling must be manual-review-required when researchConflictsPresent is true.",
        });
      }

      if (value.outcomeType === "recommended-survivor" && !value.recommendedCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendedCandidateId"],
          message: "recommendedCandidateId is required when outcomeType is recommended-survivor.",
        });
      }

      if (value.outcomeType !== "recommended-survivor" && value.recommendedCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendedCandidateId"],
          message:
            "recommendedCandidateId is only allowed when outcomeType is recommended-survivor.",
        });
      }

      if (value.outcomeType === "recommended-survivor" && value.recommendationAbsenceReason) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendationAbsenceReason"],
          message: "recommended-survivor reviews cannot include recommendationAbsenceReason.",
        });
      }

      if (value.outcomeType !== "recommended-survivor" && value.recommendationSummary) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendationSummary"],
          message:
            "recommendationSummary is only allowed when outcomeType is recommended-survivor.",
        });
      }

      if (value.outcomeType === "recommended-survivor" && value.finalistIds.length < 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistIds"],
          message: "recommended-survivor reviews require at least one finalist id.",
        });
      }

      if (
        value.outcomeType === "recommended-survivor" &&
        value.recommendedCandidateId &&
        !value.finalistIds.includes(value.recommendedCandidateId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistIds"],
          message:
            "recommended-survivor reviews must include recommendedCandidateId in finalistIds.",
        });
      }

      if (
        (value.outcomeType === "recommended-survivor" ||
          value.outcomeType === "finalists-without-recommendation") &&
        persistedFinalistCount > 0 &&
        value.finalistIds.length !== persistedFinalistCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistIds"],
          message:
            "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present.",
        });
      }

      if (
        value.outcomeType !== "recommended-survivor" &&
        value.outcomeType !== "finalists-without-recommendation" &&
        value.finalistIds.length > 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistIds"],
          message: `${value.outcomeType} reviews require finalistIds to be empty.`,
        });
      }

      if (
        value.outcomeType !== "finalists-without-recommendation" &&
        value.manualCrowningCandidateIds.length > 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualCrowningCandidateIds"],
          message:
            "manualCrowningCandidateIds are only allowed when outcomeType is finalists-without-recommendation.",
        });
      }

      if (
        value.outcomeType === "finalists-without-recommendation" &&
        value.manualCrowningCandidateIds.length > 0 &&
        !stringArrayMembersEqual(value.manualCrowningCandidateIds, value.finalistIds)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualCrowningCandidateIds"],
          message:
            "manualCrowningCandidateIds must match finalistIds when manual crowning is exposed.",
        });
      }

      if (value.manualCrowningCandidateIds.length > 0 && !value.manualReviewRecommended) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualReviewRecommended"],
          message:
            "manualReviewRecommended must be true when manual crowning candidates are exposed.",
        });
      }

      if (value.manualCrowningReason && value.manualCrowningCandidateIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualCrowningReason"],
          message:
            "manualCrowningReason is only allowed when manual crowning candidates are exposed.",
        });
      }

      if (
        value.artifactAvailability.clarifyFollowUp &&
        !(
          value.clarifyScopeKeyType &&
          value.clarifyScopeKey &&
          value.clarifyRepeatedCaseCount &&
          value.clarifyFollowUpQuestion &&
          value.clarifyMissingResultContract &&
          value.clarifyMissingJudgingBasis
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clarifyFollowUpQuestion"],
          message:
            "clarify follow-up review fields are required when a clarify-follow-up artifact is available.",
        });
      }

      if (
        (value.clarifyScopeKeyType ||
          value.clarifyScopeKey ||
          value.clarifyRepeatedCaseCount ||
          value.clarifyFollowUpQuestion ||
          value.clarifyMissingResultContract ||
          value.clarifyMissingJudgingBasis) &&
        !value.artifactAvailability.clarifyFollowUp
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactAvailability", "clarifyFollowUp"],
          message:
            "clarifyFollowUp artifact availability must be true when clarify follow-up review fields are present.",
        });
      }

      if (
        value.artifactAvailability.clarifyFollowUp &&
        value.outcomeType !== "needs-clarification" &&
        value.outcomeType !== "external-research-required"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message:
            "clarify-follow-up artifacts are only valid for needs-clarification or external-research-required reviews.",
        });
      }

      if (
        (value.outcomeType === "finalists-without-recommendation" ||
          value.outcomeType === "completed-with-validation-gaps" ||
          value.outcomeType === "needs-clarification" ||
          value.outcomeType === "external-research-required") &&
        !value.manualReviewRecommended
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualReviewRecommended"],
          message: `${value.outcomeType} reviews must recommend manual review.`,
        });
      }

      if (
        value.secondOpinionAgreement &&
        !value.artifactAvailability.secondOpinionWinnerSelection
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactAvailability", "secondOpinionWinnerSelection"],
          message:
            "secondOpinionWinnerSelection artifact availability must be true when second-opinion review fields are present.",
        });
      }

      if (
        value.artifactAvailability.secondOpinionWinnerSelection &&
        !value.secondOpinionAgreement
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondOpinionAgreement"],
          message:
            "secondOpinionAgreement is required when a second-opinion winner-selection artifact is available.",
        });
      }

      if (value.secondOpinionAgreement) {
        if (!value.secondOpinionAdapter) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["secondOpinionAdapter"],
            message:
              "secondOpinionAdapter is required when second-opinion review fields are present.",
          });
        }
        if (!value.secondOpinionSummary) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["secondOpinionSummary"],
            message:
              "secondOpinionSummary is required when second-opinion review fields are present.",
          });
        }
        if (value.secondOpinionTriggerKinds.length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["secondOpinionTriggerKinds"],
            message:
              "secondOpinionTriggerKinds must be present when second-opinion review fields are present.",
          });
        }
        if (value.secondOpinionTriggerReasons.length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["secondOpinionTriggerReasons"],
            message:
              "secondOpinionTriggerReasons must be present when second-opinion review fields are present.",
          });
        }
      }

      if (value.secondOpinionDecision === "select" && !value.secondOpinionCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondOpinionCandidateId"],
          message: "secondOpinionCandidateId is required when secondOpinionDecision is select.",
        });
      }

      if (value.secondOpinionDecision !== "select" && value.secondOpinionCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondOpinionCandidateId"],
          message: "secondOpinionCandidateId is only allowed when secondOpinionDecision is select.",
        });
      }

      if (
        value.secondOpinionAgreement === "unavailable" &&
        value.secondOpinionDecision !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secondOpinionDecision"],
          message:
            "secondOpinionDecision cannot be present when secondOpinionAgreement is unavailable.",
        });
      }

      if (
        value.outcomeType === "recommended-survivor" &&
        value.secondOpinionAgreement &&
        value.secondOpinionAgreement !== "agrees-select" &&
        !value.manualReviewRecommended
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualReviewRecommended"],
          message:
            "recommended-survivor reviews must recommend manual review when the second opinion disagrees or is unavailable.",
        });
      }

      if (value.outcomeType === "no-survivors" && value.validationGaps.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGaps"],
          message: "no-survivors reviews require validationGaps to be empty.",
        });
      }

      if (
        value.outcomeType === "completed-with-validation-gaps" &&
        value.validationPosture !== "validation-gaps"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message:
            "completed-with-validation-gaps reviews require validationPosture to be validation-gaps.",
        });
      }

      if (value.outcomeType === "no-survivors" && value.validationPosture === "validation-gaps") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message: "no-survivors reviews cannot use validation-gaps validationPosture.",
        });
      }

      if (
        value.outcomeType === "external-research-required" &&
        value.validationPosture !== "validation-gaps"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message:
            "external-research-required reviews require validationPosture to be validation-gaps.",
        });
      }

      if (
        (value.outcomeType === "needs-clarification" ||
          value.outcomeType === "abstained-before-execution") &&
        value.validationPosture !== "unknown"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message: `${value.outcomeType} reviews require validationPosture to be unknown.`,
        });
      }

      const expectedBlockedOutcomeType = value.preflightDecision
        ? getBlockedReviewOutcomeType(value.preflightDecision)
        : undefined;
      if (expectedBlockedOutcomeType && value.outcomeType !== expectedBlockedOutcomeType) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message: `preflightDecision ${value.preflightDecision} requires outcomeType ${expectedBlockedOutcomeType}.`,
        });
      }

      if (
        value.preflightDecision === "proceed" &&
        (value.outcomeType === "needs-clarification" ||
          value.outcomeType === "external-research-required" ||
          value.outcomeType === "abstained-before-execution")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message: "preflightDecision proceed cannot use a blocked preflight outcomeType.",
        });
      }
    }),
);

export const verdictToolResponseSchema = z.object({
  mode: z.literal("verdict"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  review: verdictReviewSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
});

export const verdictArchiveToolRequestSchema = z.object({
  cwd: z.string().min(1),
  count: z.number().int().min(1).optional(),
});

export const verdictArchiveToolResponseSchema = z.object({
  mode: z.literal("verdict-archive"),
  consultations: z.array(runManifestSchema),
  archive: z.string().min(1),
});

export const crownToolRequestInputSchema = z.object({
  cwd: z.string().min(1),
  branchName: z.string().min(1).optional(),
  materializationName: z.string().min(1).optional(),
  materializationLabel: z.string().min(1).optional(),
  consultationId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  withReport: z.boolean().default(false),
});

const crownToolRequestValidatedSchema = crownToolRequestInputSchema.superRefine(
  (request, context) => {
    if (
      request.branchName &&
      request.materializationName &&
      request.branchName !== request.materializationName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message:
          "materializationName must match branchName when both legacy and canonical crown request fields are present.",
      });
    }
  },
);

export const crownToolRequestSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const payload = value as Record<string, unknown>;
  const branchName = typeof payload.branchName === "string" ? payload.branchName : undefined;
  const materializationName =
    typeof payload.materializationName === "string" ? payload.materializationName : undefined;

  return {
    ...payload,
    ...(branchName
      ? { branchName }
      : materializationName
        ? { branchName: materializationName }
        : {}),
    ...(materializationName
      ? { materializationName }
      : branchName
        ? { materializationName: branchName }
        : {}),
  };
}, crownToolRequestValidatedSchema);

export const crownMaterializationCheckSchema = z.object({
  id: z.enum(["current-branch", "git-patch-artifact", "changed-paths", "workspace-sync-summary"]),
  status: z.literal("passed"),
  summary: z.string().min(1),
});

export const crownMaterializationSchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }

      const payload = value as Record<string, unknown>;
      const mode = typeof payload.mode === "string" ? payload.mode : undefined;
      const materializationMode =
        typeof payload.materializationMode === "string" ? payload.materializationMode : undefined;
      const branchName = typeof payload.branchName === "string" ? payload.branchName : undefined;
      const materializationLabel =
        typeof payload.materializationLabel === "string" ? payload.materializationLabel : undefined;
      const materializationName =
        typeof payload.materializationName === "string" ? payload.materializationName : undefined;
      const resolvedMode =
        mode ??
        (materializationMode === "branch"
          ? "git-branch"
          : materializationMode === "workspace-sync"
            ? "workspace-sync"
            : undefined);
      const resolvedMaterializationMode =
        materializationMode ??
        (mode === "git-branch"
          ? "branch"
          : mode === "workspace-sync"
            ? "workspace-sync"
            : undefined);

      return {
        ...payload,
        ...(resolvedMode ? { mode: resolvedMode } : {}),
        ...(resolvedMaterializationMode
          ? { materializationMode: resolvedMaterializationMode }
          : {}),
        ...(branchName
          ? { branchName }
          : materializationName && resolvedMaterializationMode === "branch"
            ? { branchName: materializationName }
            : {}),
        ...(materializationLabel
          ? { materializationLabel }
          : materializationName && resolvedMaterializationMode === "workspace-sync"
            ? { materializationLabel: materializationName }
            : {}),
        ...(materializationName
          ? { materializationName }
          : branchName
            ? { materializationName: branchName }
            : materializationLabel
              ? { materializationName: materializationLabel }
              : {}),
      };
    },
    z.object({
      materialized: z.literal(true),
      verified: z.literal(true),
      mode: exportModeSchema,
      materializationMode: exportMaterializationModeSchema,
      branchName: optionalNonEmptyStringSchema,
      materializationName: optionalNonEmptyStringSchema,
      materializationLabel: optionalNonEmptyStringSchema,
      currentBranch: z.string().min(1).optional(),
      changedPaths: z.array(z.string().min(1)).default([]),
      changedPathCount: z.number().int().min(0),
      checks: z.array(crownMaterializationCheckSchema).min(1),
    }),
  )
  .superRefine((materialization, context) => {
    if (materialization.mode === "git-branch" && !materialization.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch materializations must include branchName.",
        path: ["branchName"],
      });
    }

    if (materialization.materializationMode !== getExportMaterializationMode(materialization)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message:
          "materializationMode must match mode when both legacy and canonical crown materialization fields are present.",
      });
    }

    if (
      materialization.mode === "git-branch" &&
      materialization.materializationName &&
      materialization.branchName &&
      materialization.materializationName !== materialization.branchName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message: "materializationName must match branchName for git-branch crown materializations.",
      });
    }

    if (
      materialization.mode === "workspace-sync" &&
      materialization.materializationName &&
      materialization.materializationLabel &&
      materialization.materializationName !== materialization.materializationLabel
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message:
          "materializationName must match materializationLabel for workspace-sync crown materializations.",
      });
    }
  });

export const crownToolResponseSchema = z.object({
  mode: z.literal("crown"),
  plan: exportPlanSchema,
  recordPath: z.string().min(1),
  materialization: crownMaterializationSchema,
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
});

export const initToolRequestSchema = z.object({
  cwd: z.string().min(1),
  force: z.boolean().default(false),
});

export const initToolResponseSchema = z.object({
  mode: z.literal("init"),
  initialization: projectInitializationResultSchema,
});

export const setupStatusToolRequestSchema = z.object({
  cwd: z.string().min(1),
  host: adapterSchema.optional(),
});

export const hostSetupStatusSchema = z.object({
  host: adapterSchema,
  status: z.enum(["ready", "partial", "needs-setup"]),
  registered: z.boolean(),
  artifactsInstalled: z.boolean(),
  nextAction: z.string().min(1),
  notes: z.array(z.string().min(1)).default([]),
});

export const setupStatusToolResponseSchema = z.object({
  mode: z.literal("setup-status"),
  cwd: z.string().min(1),
  projectInitialized: z.boolean(),
  configPath: z.string().min(1).optional(),
  advancedConfigPath: z.string().min(1).optional(),
  targetPrefix: commandPrefixSchema,
  hosts: z.array(hostSetupStatusSchema).min(1),
  summary: z.string().min(1),
});

export type McpToolId = z.infer<typeof mcpToolIdSchema>;
export type ToolBinding = z.infer<typeof toolBindingSchema>;
export type ToolMetadata = z.infer<typeof toolMetadataSchema>;
export type CommandArgument = z.infer<typeof commandArgumentSchema>;
export type CommandManifestEntry = z.infer<typeof commandManifestEntrySchema>;
export type ConsultToolRequest = z.infer<typeof consultToolRequestSchema>;
export type ConsultToolResponse = z.infer<typeof consultToolResponseSchema>;
export type PlanToolRequest = z.infer<typeof planToolRequestSchema>;
export type PlanToolResponse = z.infer<typeof planToolResponseSchema>;
export type DraftToolRequest = z.infer<typeof draftToolRequestSchema>;
export type DraftToolResponse = z.infer<typeof draftToolResponseSchema>;
export type VerdictToolRequest = z.infer<typeof verdictToolRequestSchema>;
export type VerdictReview = z.infer<typeof verdictReviewSchema>;
export type VerdictToolResponse = z.infer<typeof verdictToolResponseSchema>;
export type VerdictArchiveToolRequest = z.infer<typeof verdictArchiveToolRequestSchema>;
export type VerdictArchiveToolResponse = z.infer<typeof verdictArchiveToolResponseSchema>;
export type CrownToolRequest = z.infer<typeof crownToolRequestSchema>;
export type CrownMaterialization = z.infer<typeof crownMaterializationSchema>;
export type CrownMaterializationCheck = z.infer<typeof crownMaterializationCheckSchema>;
export type CrownToolResponse = z.infer<typeof crownToolResponseSchema>;
export type InitToolRequest = z.infer<typeof initToolRequestSchema>;
export type InitToolResponse = z.infer<typeof initToolResponseSchema>;
export type SetupStatusToolRequest = z.infer<typeof setupStatusToolRequestSchema>;
export type SetupStatusToolResponse = z.infer<typeof setupStatusToolResponseSchema>;
