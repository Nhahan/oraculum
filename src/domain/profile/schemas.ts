import { z } from "zod";

import { artifactPathSegmentSchema } from "../artifact-id.js";
import { oraclePathPolicySchema, oracleRelativeCwdSchema, roundIdSchema } from "../config.js";
import {
  consultationProfileIds,
  decisionConfidenceLevels,
  profileStrategyIds,
} from "./constants.js";

export const decisionConfidenceSchema = z.enum(decisionConfidenceLevels);
export const consultationProfileIdSchema = z.enum(consultationProfileIds);
export const profileStrategyIdSchema = z.enum(profileStrategyIds);
export const agentProfileRecommendationIdSchema = z.string().min(1);
export const packageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun", "unknown"]);
export const profileSignalKindSchema = z.enum([
  "intent",
  "language",
  "build-system",
  "test-runner",
  "command",
]);
export const profileSignalSourceSchema = z.enum([
  "root-config",
  "workspace-config",
  "task-text",
  "explicit-config",
  "local-tool",
  "fallback-inference",
]);

export const profileSignalProvenanceSchema = z.object({
  signal: z.string().min(1),
  source: profileSignalSourceSchema,
  path: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
});

export const profileCommandSourceSchema = z.enum(["repo-local-script", "product-owned"]);
export const profileCommandSafetySchema = z.enum([
  "repo-local-declared",
  "product-owned-read-only",
  "product-owned-temporary",
  "requires-explicit-opt-in",
]);
export const profileSkippedCommandReasonSchema = z.enum([
  "ambiguous-explicit-command",
  "ambiguous-local-command",
  "ambiguous-package-manager",
  "ambiguous-workspace-command",
  "duplicate-expensive-command",
  "global-tool-not-explicit",
  "missing-config",
  "missing-explicit-command",
  "requires-opt-in",
  "unsafe-db-touching",
  "unsupported-package-manager",
]);

export const profileCommandCandidateSchema = z.object({
  id: artifactPathSegmentSchema,
  roundId: roundIdSchema,
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  invariant: z.string().min(1),
  dedupeKey: z.string().min(1).optional(),
  relativeCwd: oracleRelativeCwdSchema.optional(),
  pathPolicy: oraclePathPolicySchema.optional(),
  source: profileCommandSourceSchema.optional(),
  capability: z.string().min(1).optional(),
  safety: profileCommandSafetySchema.optional(),
  requiresExplicitOptIn: z.boolean().optional(),
  provenance: profileSignalProvenanceSchema.optional(),
  safetyRationale: z.string().min(1).optional(),
});

export const profileCapabilitySignalSchema = z.object({
  kind: profileSignalKindSchema,
  value: z.string().min(1),
  source: profileSignalSourceSchema,
  path: z.string().min(1).optional(),
  confidence: decisionConfidenceSchema.default("medium"),
  detail: z.string().min(1).optional(),
});

export const profileSkippedCommandCandidateSchema = z.object({
  id: artifactPathSegmentSchema,
  label: z.string().min(1),
  capability: z.string().min(1),
  reason: profileSkippedCommandReasonSchema,
  detail: z.string().min(1),
  provenance: profileSignalProvenanceSchema.optional(),
});

export const profileWorkspaceMetadataSchema = z.object({
  root: z.string().min(1),
  label: z.string().min(1),
  manifests: z.array(z.string().min(1)).default([]),
});

export const profileRepoSignalsSchema = z.object({
  packageManager: packageManagerSchema,
  scripts: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  files: z.array(z.string().min(1)).default([]),
  workspaceRoots: z.array(z.string().min(1)).default([]),
  workspaceMetadata: z.array(profileWorkspaceMetadataSchema).default([]),
  notes: z.array(z.string().min(1)).default([]),
  capabilities: z.array(profileCapabilitySignalSchema).default([]),
  provenance: z.array(profileSignalProvenanceSchema).default([]),
  commandCatalog: z.array(profileCommandCandidateSchema).default([]),
  skippedCommandCandidates: z.array(profileSkippedCommandCandidateSchema).default([]),
});

export const agentProfileRecommendationSchema = z.object({
  validationProfileId: agentProfileRecommendationIdSchema,
  confidence: decisionConfidenceSchema,
  validationSummary: z.string().min(1),
  candidateCount: z.number().int().min(1).max(16),
  strategyIds: z.array(profileStrategyIdSchema).min(1).max(4),
  selectedCommandIds: z.array(z.string().min(1)),
  validationGaps: z.array(z.string().min(1)),
});

export const consultationProfileSelectionSchema = z.object({
  validationProfileId: consultationProfileIdSchema,
  confidence: decisionConfidenceSchema,
  source: z.enum(["llm-recommendation", "fallback-detection"]),
  validationSummary: z.string().min(1),
  candidateCount: z.number().int().min(1).max(16),
  strategyIds: z.array(z.string().min(1)).min(1),
  oracleIds: z.array(artifactPathSegmentSchema).default([]),
  validationGaps: z.array(z.string().min(1)).default([]),
  validationSignals: z.array(z.string().min(1)).default([]),
});

export const consultationProfileSelectionArtifactSchema = z
  .object({
    runId: z.string().min(1),
    signals: profileRepoSignalsSchema,
    recommendation: agentProfileRecommendationSchema,
    appliedSelection: consultationProfileSelectionSchema,
    llmSkipped: z.boolean().optional(),
    llmFailure: z.string().min(1).optional(),
    llmResult: z.unknown().optional(),
  })
  .passthrough();

export type DecisionConfidence = z.infer<typeof decisionConfidenceSchema>;
export type ConsultationProfileId = z.infer<typeof consultationProfileIdSchema>;
export type ProfileStrategyId = z.infer<typeof profileStrategyIdSchema>;
export type PackageManager = z.infer<typeof packageManagerSchema>;
export type ProfileCommandCandidate = z.infer<typeof profileCommandCandidateSchema>;
export type ProfileCapabilitySignal = z.infer<typeof profileCapabilitySignalSchema>;
export type ProfileSignalProvenance = z.infer<typeof profileSignalProvenanceSchema>;
export type ProfileSkippedCommandCandidate = z.infer<typeof profileSkippedCommandCandidateSchema>;
export type ProfileRepoSignals = z.infer<typeof profileRepoSignalsSchema>;
export type AgentProfileRecommendation = z.infer<typeof agentProfileRecommendationSchema>;
export type ConsultationProfileSelection = z.infer<typeof consultationProfileSelectionSchema>;
