import { z } from "zod";

import { adapterSchema } from "./config.js";
import {
  consultationJudgingBasisKindSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  exportModeSchema,
  exportPlanSchema,
  optionalNonEmptyStringSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "./run.js";
import { taskSourceKindSchema } from "./task.js";

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

export const verdictReviewSchema = z.object({
  outcomeType: consultationOutcomeTypeSchema,
  verificationLevel: consultationVerificationLevelSchema,
  validationPosture: consultationValidationPostureSchema,
  judgingBasisKind: consultationJudgingBasisKindSchema,
  taskSourceKind: taskSourceKindSchema,
  taskSourcePath: z.string().min(1),
  taskOriginSourceKind: taskSourceKindSchema.optional(),
  taskOriginSourcePath: z.string().min(1).optional(),
  recommendedCandidateId: z.string().min(1).optional(),
  finalistIds: z.array(z.string().min(1)).default([]),
  profileId: z.string().min(1).optional(),
  profileMissingCapabilities: z.array(z.string().min(1)).default([]),
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
});

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

export const crownToolRequestSchema = z.object({
  cwd: z.string().min(1),
  branchName: z.string().min(1).optional(),
  materializationLabel: z.string().min(1).optional(),
  consultationId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  withReport: z.boolean().default(false),
});

export const crownMaterializationCheckSchema = z.object({
  id: z.enum(["current-branch", "git-patch-artifact", "changed-paths", "workspace-sync-summary"]),
  status: z.literal("passed"),
  summary: z.string().min(1),
});

export const crownMaterializationSchema = z
  .object({
    materialized: z.literal(true),
    verified: z.literal(true),
    mode: exportModeSchema,
    branchName: optionalNonEmptyStringSchema,
    materializationLabel: optionalNonEmptyStringSchema,
    currentBranch: z.string().min(1).optional(),
    changedPaths: z.array(z.string().min(1)).default([]),
    changedPathCount: z.number().int().min(0),
    checks: z.array(crownMaterializationCheckSchema).min(1),
  })
  .superRefine((materialization, context) => {
    if (materialization.mode === "git-branch" && !materialization.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch materializations must include branchName.",
        path: ["branchName"],
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
