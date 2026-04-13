import { z } from "zod";

import { adapterSchema } from "./config.js";
import { decisionConfidenceSchema } from "./profile.js";
import {
  consultationJudgingBasisKindSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  exportMaterializationModeSchema,
  exportModeSchema,
  exportPlanSchema,
  getExportMaterializationMode,
  optionalNonEmptyStringSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "./run.js";
import { stringArrayMembersEqual } from "./schema-compat.js";
import { taskSourceKindSchema } from "./task.js";

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
  preflightReadinessPath: z.string().min(1).optional(),
  researchBriefPath: z.string().min(1).optional(),
  profileSelectionPath: z.string().min(1).optional(),
  comparisonJsonPath: z.string().min(1).optional(),
  comparisonMarkdownPath: z.string().min(1).optional(),
  winnerSelectionPath: z.string().min(1).optional(),
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

export const draftToolRequestSchema = z.object({
  cwd: z.string().min(1),
  taskInput: z.string().min(1),
  agent: adapterSchema.optional(),
  candidates: z.number().int().min(1).max(16).optional(),
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

    return payload;
  },
  z
    .object({
      outcomeType: consultationOutcomeTypeSchema,
      verificationLevel: consultationVerificationLevelSchema,
      validationPosture: consultationValidationPostureSchema,
      judgingBasisKind: consultationJudgingBasisKindSchema,
      taskSourceKind: taskSourceKindSchema,
      taskSourcePath: z.string().min(1),
      taskArtifactKind: z.string().min(1).optional(),
      targetArtifactPath: z.string().min(1).optional(),
      researchSummary: z.string().min(1).optional(),
      researchConfidence: decisionConfidenceSchema.optional(),
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
      artifactAvailability: z.object({
        preflightReadiness: z.boolean(),
        researchBrief: z.boolean(),
        profileSelection: z.boolean(),
        comparisonReport: z.boolean(),
        winnerSelection: z.boolean(),
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
