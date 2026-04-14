import { z } from "zod";

import { oraclePathPolicySchema, oracleRelativeCwdSchema, roundIdSchema } from "./config.js";
import { stringArrayMembersEqual } from "./schema-compat.js";

export const decisionConfidenceLevels = ["low", "medium", "high"] as const;
export const consultationProfileIds = ["generic", "library", "frontend", "migration"] as const;
export const profileStrategyIds = [
  "minimal-change",
  "safety-first",
  "test-amplified",
  "structural-refactor",
] as const;

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
  "migration-tool",
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
  id: z.string().min(1),
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
  id: z.string().min(1),
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

const agentProfileRecommendationBaseSchema = z
  .object({
    profileId: agentProfileRecommendationIdSchema.optional(),
    validationProfileId: agentProfileRecommendationIdSchema,
    confidence: decisionConfidenceSchema,
    summary: z.string().min(1).optional(),
    validationSummary: z.string().min(1),
    candidateCount: z.number().int().min(1).max(16),
    strategyIds: z.array(profileStrategyIdSchema).min(1).max(4),
    selectedCommandIds: z.array(z.string().min(1)),
    missingCapabilities: z.array(z.string().min(1)).optional(),
    validationGaps: z.array(z.string().min(1)),
  })
  .superRefine((value, context) => {
    if (value.profileId && value.validationProfileId !== value.profileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileId"],
        message: "profileId must match validationProfileId when both are present.",
      });
    }

    if (value.summary && value.validationSummary !== value.summary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "summary must match validationSummary when both are present.",
      });
    }

    if (
      value.missingCapabilities &&
      !stringArrayMembersEqual(value.missingCapabilities, value.validationGaps)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingCapabilities"],
        message:
          "missingCapabilities must match validationGaps when both legacy and validation aliases are present.",
      });
    }
  });

export const agentProfileRecommendationSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const payload = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...payload };

  if (normalized.profileId === null) {
    delete normalized.profileId;
  }
  if (normalized.validationProfileId === null) {
    delete normalized.validationProfileId;
  }
  if (normalized.summary === null) {
    delete normalized.summary;
  }
  if (normalized.validationSummary === null) {
    delete normalized.validationSummary;
  }
  if (normalized.missingCapabilities === null) {
    delete normalized.missingCapabilities;
  }
  if (normalized.validationGaps === null) {
    delete normalized.validationGaps;
  }

  if (
    typeof normalized.profileId !== "string" &&
    typeof normalized.validationProfileId === "string"
  ) {
    normalized.profileId = normalized.validationProfileId;
  }
  if (
    typeof normalized.validationProfileId !== "string" &&
    typeof normalized.profileId === "string"
  ) {
    normalized.validationProfileId = normalized.profileId;
  }

  if (typeof normalized.summary !== "string" && typeof normalized.validationSummary === "string") {
    normalized.summary = normalized.validationSummary;
  }
  if (typeof normalized.validationSummary !== "string" && typeof normalized.summary === "string") {
    normalized.validationSummary = normalized.summary;
  }

  if (!Array.isArray(normalized.missingCapabilities) && Array.isArray(normalized.validationGaps)) {
    normalized.missingCapabilities = normalized.validationGaps;
  }
  if (!Array.isArray(normalized.validationGaps) && Array.isArray(normalized.missingCapabilities)) {
    normalized.validationGaps = normalized.missingCapabilities;
  }

  return normalized;
}, agentProfileRecommendationBaseSchema);

const consultationProfileSelectionBaseSchema = z
  .object({
    profileId: consultationProfileIdSchema.optional(),
    validationProfileId: consultationProfileIdSchema,
    confidence: decisionConfidenceSchema,
    source: z.enum(["llm-recommendation", "fallback-detection"]),
    summary: z.string().min(1).optional(),
    validationSummary: z.string().min(1),
    candidateCount: z.number().int().min(1).max(16),
    strategyIds: z.array(z.string().min(1)).min(1),
    oracleIds: z.array(z.string().min(1)).default([]),
    missingCapabilities: z.array(z.string().min(1)).optional(),
    validationGaps: z.array(z.string().min(1)).default([]),
    signals: z.array(z.string().min(1)).optional(),
    validationSignals: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, context) => {
    if (value.profileId && value.profileId !== value.validationProfileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileId"],
        message: "profileId must match validationProfileId when both are present.",
      });
    }

    if (value.summary && value.summary !== value.validationSummary) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "summary must match validationSummary when both are present.",
      });
    }

    if (
      value.missingCapabilities &&
      !stringArrayMembersEqual(value.missingCapabilities, value.validationGaps)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingCapabilities"],
        message:
          "missingCapabilities must match validationGaps when both legacy and validation aliases are present.",
      });
    }

    if (value.signals && !stringArrayMembersEqual(value.signals, value.validationSignals)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signals"],
        message:
          "signals must match validationSignals when both legacy and validation aliases are present.",
      });
    }
  });

export const consultationProfileSelectionSchema = z.preprocess((value) => {
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

  if (typeof payload.validationSummary !== "string" && typeof payload.summary === "string") {
    payload.validationSummary = payload.summary;
  }
  if (typeof payload.summary !== "string" && typeof payload.validationSummary === "string") {
    payload.summary = payload.validationSummary;
  }

  if (!Array.isArray(payload.validationGaps) && Array.isArray(payload.missingCapabilities)) {
    payload.validationGaps = payload.missingCapabilities;
  }
  if (!Array.isArray(payload.missingCapabilities) && Array.isArray(payload.validationGaps)) {
    payload.missingCapabilities = payload.validationGaps;
  }

  if (!Array.isArray(payload.validationSignals) && Array.isArray(payload.signals)) {
    payload.validationSignals = payload.signals;
  }
  if (!Array.isArray(payload.signals) && Array.isArray(payload.validationSignals)) {
    payload.signals = payload.validationSignals;
  }

  return payload;
}, consultationProfileSelectionBaseSchema);

export function buildAgentProfileRecommendationJsonSchema(): Record<string, unknown> {
  const properties = {
    profileId: {
      type: "string",
    },
    validationProfileId: {
      type: "string",
    },
    confidence: {
      type: "string",
      enum: [...decisionConfidenceLevels],
    },
    summary: { type: "string", minLength: 1 },
    validationSummary: { type: "string", minLength: 1 },
    candidateCount: { type: "integer", minimum: 1, maximum: 16 },
    strategyIds: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "string",
        enum: [...profileStrategyIds],
      },
    },
    selectedCommandIds: {
      type: "array",
      items: { type: "string" },
    },
    missingCapabilities: {
      type: "array",
      items: { type: "string" },
    },
    validationGaps: {
      type: "array",
      items: { type: "string" },
    },
  } satisfies Record<string, unknown>;

  const commonRequired = ["confidence", "candidateCount", "strategyIds", "selectedCommandIds"];

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...commonRequired, "validationProfileId", "validationSummary", "validationGaps"],
  };
}

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

export function toCanonicalAgentProfileRecommendation(recommendation: AgentProfileRecommendation): {
  validationProfileId: string;
  confidence: DecisionConfidence;
  validationSummary: string;
  candidateCount: number;
  strategyIds: string[];
  selectedCommandIds: string[];
  validationGaps: string[];
} {
  const validationProfileId = getValidationProfileId(recommendation);
  const validationSummary = getValidationSummary(recommendation);

  if (!validationProfileId || !validationSummary) {
    throw new Error("Canonical agent profile recommendation requires validation profile fields.");
  }

  return {
    validationProfileId,
    confidence: recommendation.confidence,
    validationSummary,
    candidateCount: recommendation.candidateCount,
    strategyIds: recommendation.strategyIds,
    selectedCommandIds: recommendation.selectedCommandIds,
    validationGaps: getValidationGaps(recommendation),
  };
}

export function toCanonicalConsultationProfileSelection(selection: ConsultationProfileSelection): {
  validationProfileId: ConsultationProfileId;
  confidence: DecisionConfidence;
  source: ConsultationProfileSelection["source"];
  validationSummary: string;
  candidateCount: number;
  strategyIds: string[];
  oracleIds: string[];
  validationGaps: string[];
  validationSignals: string[];
} {
  const validationProfileId = getValidationProfileId(selection);
  const validationSummary = getValidationSummary(selection);

  if (!validationProfileId || !validationSummary) {
    throw new Error("Canonical consultation profile selection requires validation profile fields.");
  }

  return {
    validationProfileId,
    confidence: selection.confidence,
    source: selection.source,
    validationSummary,
    candidateCount: selection.candidateCount,
    strategyIds: selection.strategyIds,
    oracleIds: selection.oracleIds,
    validationGaps: getValidationGaps(selection),
    validationSignals: getValidationSignals(selection),
  };
}

export function getValidationProfileId(
  selection:
    | {
        profileId?: ConsultationProfileId | undefined;
        validationProfileId?: ConsultationProfileId | undefined;
      }
    | undefined,
): ConsultationProfileId | undefined;
export function getValidationProfileId(
  selection:
    | {
        profileId?: string | undefined;
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined;
export function getValidationProfileId(
  selection:
    | {
        profileId?: string | undefined;
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationProfileId ?? selection?.profileId;
}

export function isSupportedConsultationProfileId(value: string): value is ConsultationProfileId {
  return consultationProfileIds.includes(value as ConsultationProfileId);
}

export function getValidationSummary(
  selection:
    | {
        summary?: string | undefined;
        validationSummary?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationSummary ?? selection?.summary;
}

export function getValidationSignals(
  selection:
    | {
        signals?: string[] | undefined;
        validationSignals?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationSignals ?? selection?.signals ?? [];
}

export function getValidationGaps(
  selection:
    | {
        missingCapabilities?: string[] | undefined;
        validationGaps?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationGaps ?? selection?.missingCapabilities ?? [];
}
