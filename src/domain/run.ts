import { z } from "zod";

import { adapterSchema, roundIdSchema } from "./config.js";
import {
  consultationProfileSelectionSchema,
  decisionConfidenceSchema,
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "./profile.js";
import { taskPacketSummarySchema, taskSourceKindSchema } from "./task.js";

export const candidateStatusSchema = z.enum([
  "planned",
  "running",
  "executed",
  "failed",
  "judged",
  "eliminated",
  "promoted",
  "exported",
]);

export const workspaceModeSchema = z.enum(["copy", "git-worktree"]);
export const roundExecutionStatusSchema = z.enum(["pending", "running", "completed"]);
export const consultationOutcomeTypeSchema = z.enum([
  "pending-execution",
  "running",
  "needs-clarification",
  "external-research-required",
  "abstained-before-execution",
  "recommended-survivor",
  "finalists-without-recommendation",
  "no-survivors",
  "completed-with-validation-gaps",
]);
export const consultationValidationPostureSchema = z.enum([
  "sufficient",
  "validation-gaps",
  "unknown",
]);
export const consultationJudgingBasisKindSchema = z.enum([
  "repo-local-oracle",
  "missing-capability",
  "unknown",
]);
export const consultationVerificationLevelSchema = z.enum([
  "none",
  "lightweight",
  "standard",
  "thorough",
]);
export const consultationPreflightDecisionSchema = z.enum([
  "proceed",
  "needs-clarification",
  "external-research-required",
  "abstain",
]);
export const consultationResearchPostureSchema = z.enum([
  "repo-only",
  "repo-plus-external-docs",
  "external-research-required",
  "unknown",
]);
export const consultationNextActionSchema = z.enum([
  "reopen-verdict",
  "browse-archive",
  "review-preflight-readiness",
  "answer-clarification-and-rerun",
  "gather-external-research-and-rerun",
  "rerun-with-research-brief",
  "refresh-stale-research-and-rerun",
  "revise-task-and-rerun",
  "crown-recommended-survivor",
  "inspect-comparison-report",
  "review-validation-gaps",
  "add-repo-local-oracle",
  "rerun-with-different-candidate-count",
]);

export const candidateManifestSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  strategyLabel: z.string().min(1),
  status: candidateStatusSchema,
  workspaceDir: z.string().min(1),
  taskPacketPath: z.string().min(1),
  lastRunResultPath: z.string().min(1).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  baseRevision: z.string().min(1).optional(),
  baseSnapshotPath: z.string().min(1).optional(),
  repairCount: z.number().int().min(0).default(0),
  repairedRounds: z.array(roundIdSchema).default([]),
  createdAt: z.string().min(1),
});

export const runStatusSchema = z.enum(["planned", "running", "completed"]);
export const roundManifestSchema = z.object({
  id: roundIdSchema,
  label: z.string().min(1),
  status: roundExecutionStatusSchema,
  verdictCount: z.number().int().min(0),
  survivorCount: z.number().int().min(0),
  eliminatedCount: z.number().int().min(0),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
});

export const runRecommendationSchema = z.object({
  candidateId: z.string().min(1),
  summary: z.string().min(1),
  confidence: decisionConfidenceSchema,
  source: z.enum(["llm-judge", "fallback-policy"]),
});

export const reportBundleSchema = z.object({
  rootDir: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
});

export const exportModeSchema = z.enum(["git-branch", "workspace-sync"]);
export const optionalNonEmptyStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

function getExpectedOutcomeFlags(type: z.infer<typeof consultationOutcomeTypeSchema>): {
  terminal: boolean;
  crownable: boolean;
} {
  switch (type) {
    case "pending-execution":
    case "running":
      return { terminal: false, crownable: false };
    case "recommended-survivor":
      return { terminal: true, crownable: true };
    case "needs-clarification":
    case "external-research-required":
    case "abstained-before-execution":
    case "finalists-without-recommendation":
    case "no-survivors":
    case "completed-with-validation-gaps":
      return { terminal: true, crownable: false };
  }
}

function getBlockedOutcomeType(
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

export const consultationOutcomeSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = value as Record<string, unknown>;
    const missingCapabilityCount =
      typeof payload.missingCapabilityCount === "number"
        ? payload.missingCapabilityCount
        : undefined;
    const validationGapCount =
      typeof payload.validationGapCount === "number" ? payload.validationGapCount : undefined;

    return {
      ...payload,
      ...(validationGapCount !== undefined
        ? { validationGapCount }
        : missingCapabilityCount !== undefined
          ? { validationGapCount: missingCapabilityCount }
          : {}),
      ...(missingCapabilityCount !== undefined
        ? { missingCapabilityCount }
        : validationGapCount !== undefined
          ? { missingCapabilityCount: validationGapCount }
          : {}),
    };
  },
  z
    .object({
      type: consultationOutcomeTypeSchema,
      terminal: z.boolean(),
      crownable: z.boolean(),
      finalistCount: z.number().int().min(0),
      recommendedCandidateId: z.string().min(1).optional(),
      validationPosture: consultationValidationPostureSchema,
      verificationLevel: consultationVerificationLevelSchema,
      missingCapabilityCount: z.number().int().min(0).optional(),
      validationGapCount: z.number().int().min(0),
      judgingBasisKind: consultationJudgingBasisKindSchema,
    })
    .superRefine((value, context) => {
      const expectedFlags = getExpectedOutcomeFlags(value.type);
      if (value.terminal !== expectedFlags.terminal) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["terminal"],
          message: `terminal must be ${expectedFlags.terminal} when outcome type is ${value.type}.`,
        });
      }

      if (value.crownable !== expectedFlags.crownable) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["crownable"],
          message: `crownable must be ${expectedFlags.crownable} when outcome type is ${value.type}.`,
        });
      }

      if (
        value.missingCapabilityCount !== undefined &&
        value.missingCapabilityCount !== value.validationGapCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapCount"],
          message:
            "validationGapCount must match missingCapabilityCount when both legacy and validation aliases are present.",
        });
      }

      if (value.type === "recommended-survivor" && !value.recommendedCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendedCandidateId"],
          message: "recommendedCandidateId is required when outcome type is recommended-survivor.",
        });
      }

      if (value.type !== "recommended-survivor" && value.recommendedCandidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendedCandidateId"],
          message:
            "recommendedCandidateId is only allowed when outcome type is recommended-survivor.",
        });
      }

      if (
        (value.type === "recommended-survivor" ||
          value.type === "finalists-without-recommendation") &&
        value.finalistCount < 1
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistCount"],
          message:
            "recommended-survivor and finalists-without-recommendation outcomes require finalistCount to be at least 1.",
        });
      }

      if (
        value.type !== "recommended-survivor" &&
        value.type !== "finalists-without-recommendation" &&
        value.finalistCount !== 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistCount"],
          message: `${value.type} outcomes require finalistCount to be 0.`,
        });
      }

      if (value.type === "completed-with-validation-gaps" && value.validationGapCount < 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapCount"],
          message:
            "completed-with-validation-gaps outcomes require validationGapCount to be at least 1.",
        });
      }

      if (
        value.type === "completed-with-validation-gaps" &&
        value.validationPosture !== "validation-gaps"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message:
            "completed-with-validation-gaps outcomes require validationPosture to be validation-gaps.",
        });
      }

      if (value.type === "no-survivors" && value.validationGapCount !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapCount"],
          message: "no-survivors outcomes require validationGapCount to be 0.",
        });
      }

      if (value.type === "no-survivors" && value.validationPosture === "validation-gaps") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message: "no-survivors outcomes cannot use validation-gaps validationPosture.",
        });
      }

      if (
        value.type === "external-research-required" &&
        value.validationPosture !== "validation-gaps"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message:
            "external-research-required outcomes require validationPosture to be validation-gaps.",
        });
      }

      if (
        (value.type === "needs-clarification" || value.type === "abstained-before-execution") &&
        value.validationPosture !== "unknown"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message: `${value.type} outcomes require validationPosture to be unknown.`,
        });
      }
    }),
);
export const consultationPreflightSchema = z
  .object({
    decision: consultationPreflightDecisionSchema,
    confidence: decisionConfidenceSchema,
    summary: z.string().min(1),
    researchPosture: consultationResearchPostureSchema,
    researchBasisDrift: z.boolean().optional(),
    clarificationQuestion: z.string().min(1).optional(),
    researchQuestion: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "needs-clarification" && !value.clarificationQuestion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clarificationQuestion"],
        message: "clarificationQuestion is required when decision is needs-clarification.",
      });
    }

    if (value.decision === "external-research-required" && !value.researchQuestion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["researchQuestion"],
        message: "researchQuestion is required when decision is external-research-required.",
      });
    }
  });
export const consultationResearchBriefSchema = z.object({
  decision: z.literal("external-research-required"),
  question: z.string().min(1),
  confidence: decisionConfidenceSchema.optional(),
  researchPosture: consultationResearchPostureSchema,
  summary: z.string().min(1),
  task: taskPacketSummarySchema,
  sources: z
    .array(
      z.object({
        kind: z.enum(["repo-doc", "official-doc", "curated-doc", "other"]),
        title: z.string().min(1),
        locator: z.string().min(1),
      }),
    )
    .default([]),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1),
        sourceLocators: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  versionNotes: z.array(z.string().min(1)).default([]),
  unresolvedConflicts: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([]),
  signalSummary: z.array(z.string().min(1)).default([]),
  signalFingerprint: z.string().min(1).optional(),
});
export const savedConsultationStatusSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = value as Record<string, unknown>;
    const missingCapabilitiesPresent =
      typeof payload.missingCapabilitiesPresent === "boolean"
        ? payload.missingCapabilitiesPresent
        : undefined;
    const validationGapsPresent =
      typeof payload.validationGapsPresent === "boolean"
        ? payload.validationGapsPresent
        : undefined;

    return {
      ...payload,
      ...(validationGapsPresent !== undefined
        ? { validationGapsPresent }
        : missingCapabilitiesPresent !== undefined
          ? { validationGapsPresent: missingCapabilitiesPresent }
          : {}),
      ...(missingCapabilitiesPresent !== undefined
        ? { missingCapabilitiesPresent }
        : validationGapsPresent !== undefined
          ? { missingCapabilitiesPresent: validationGapsPresent }
          : {}),
    };
  },
  z
    .object({
      consultationId: z.string().min(1),
      consultationState: runStatusSchema,
      outcomeType: consultationOutcomeTypeSchema,
      terminal: z.boolean(),
      crownable: z.boolean(),
      taskSourceKind: taskSourceKindSchema,
      taskSourcePath: z.string().min(1),
      taskArtifactKind: z.string().min(1).optional(),
      targetArtifactPath: z.string().min(1).optional(),
      researchConfidence: decisionConfidenceSchema.optional(),
      researchSignalCount: z.number().int().min(0),
      researchSignalFingerprint: z.string().min(1).optional(),
      researchBasisDrift: z.boolean().optional(),
      researchRerunRecommended: z.boolean(),
      researchRerunInputPath: z.string().min(1).optional(),
      researchConflictsPresent: z.boolean(),
      taskOriginSourceKind: taskSourceKindSchema.optional(),
      taskOriginSourcePath: z.string().min(1).optional(),
      validationPosture: consultationValidationPostureSchema,
      validationProfileId: z.string().min(1).optional(),
      validationSummary: z.string().min(1).optional(),
      validationSignals: z.array(z.string().min(1)).default([]),
      validationGaps: z.array(z.string().min(1)).default([]),
      recommendedCandidateId: z.string().min(1).optional(),
      finalistCount: z.number().int().min(0),
      missingCapabilitiesPresent: z.boolean().optional(),
      validationGapsPresent: z.boolean(),
      judgingBasisKind: consultationJudgingBasisKindSchema,
      verificationLevel: consultationVerificationLevelSchema,
      preflightDecision: consultationPreflightDecisionSchema.optional(),
      researchPosture: consultationResearchPostureSchema,
      nextActions: z.array(consultationNextActionSchema).default([]),
      updatedAt: z.string().min(1),
    })
    .superRefine((value, context) => {
      const expectedFlags = getExpectedOutcomeFlags(value.outcomeType);
      if (value.terminal !== expectedFlags.terminal) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["terminal"],
          message: `terminal must be ${expectedFlags.terminal} when outcomeType is ${value.outcomeType}.`,
        });
      }

      if (value.crownable !== expectedFlags.crownable) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["crownable"],
          message: `crownable must be ${expectedFlags.crownable} when outcomeType is ${value.outcomeType}.`,
        });
      }

      if (
        value.missingCapabilitiesPresent !== undefined &&
        value.missingCapabilitiesPresent !== value.validationGapsPresent
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapsPresent"],
          message:
            "validationGapsPresent must match missingCapabilitiesPresent when both legacy and validation aliases are present.",
        });
      }

      if (value.validationGaps.length > 0 && !value.validationGapsPresent) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapsPresent"],
          message: "validationGapsPresent must be true when detailed validationGaps are present.",
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

      if (
        (value.outcomeType === "recommended-survivor" ||
          value.outcomeType === "finalists-without-recommendation") &&
        value.finalistCount < 1
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistCount"],
          message:
            "recommended-survivor and finalists-without-recommendation statuses require finalistCount to be at least 1.",
        });
      }

      if (
        value.outcomeType !== "recommended-survivor" &&
        value.outcomeType !== "finalists-without-recommendation" &&
        value.finalistCount !== 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalistCount"],
          message: `${value.outcomeType} statuses require finalistCount to be 0.`,
        });
      }

      if (value.outcomeType === "completed-with-validation-gaps" && !value.validationGapsPresent) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapsPresent"],
          message:
            "completed-with-validation-gaps statuses require validationGapsPresent to be true.",
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
            "completed-with-validation-gaps statuses require validationPosture to be validation-gaps.",
        });
      }

      if (value.outcomeType === "no-survivors" && value.validationGapsPresent) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationGapsPresent"],
          message: "no-survivors statuses require validationGapsPresent to be false.",
        });
      }

      if (value.outcomeType === "no-survivors" && value.validationPosture === "validation-gaps") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validationPosture"],
          message: "no-survivors statuses cannot use validation-gaps validationPosture.",
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
            "external-research-required statuses require validationPosture to be validation-gaps.",
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
          message: `${value.outcomeType} statuses require validationPosture to be unknown.`,
        });
      }

      const expectedBlockedOutcomeType = value.preflightDecision
        ? getBlockedOutcomeType(value.preflightDecision)
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

      if (value.consultationState === "planned" && value.outcomeType !== "pending-execution") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message: "planned consultation statuses must use outcomeType pending-execution.",
        });
      }

      if (value.consultationState === "running" && value.outcomeType !== "running") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message: "running consultation statuses must use outcomeType running.",
        });
      }

      if (
        value.consultationState === "completed" &&
        (value.outcomeType === "pending-execution" || value.outcomeType === "running")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcomeType"],
          message:
            "completed consultation statuses cannot use outcomeType pending-execution or running.",
        });
      }
    }),
);

export const runManifestSchema = z
  .object({
    id: z.string().min(1),
    status: runStatusSchema,
    taskPath: z.string().min(1),
    taskPacket: taskPacketSummarySchema,
    agent: adapterSchema,
    configPath: z.string().min(1).optional(),
    candidateCount: z.number().int().min(0),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1).optional(),
    rounds: z.array(roundManifestSchema),
    candidates: z.array(candidateManifestSchema),
    preflight: consultationPreflightSchema.optional(),
    profileSelection: consultationProfileSelectionSchema.optional(),
    recommendedWinner: runRecommendationSchema.optional(),
    outcome: consultationOutcomeSchema.optional(),
  })
  .superRefine((value, context) => {
    const expectedBlockedOutcomeType = value.preflight
      ? getBlockedOutcomeType(value.preflight.decision)
      : undefined;

    if (expectedBlockedOutcomeType && value.outcome?.type !== expectedBlockedOutcomeType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome", "type"],
        message: `blocked preflight decision ${value.preflight?.decision} requires outcome type ${expectedBlockedOutcomeType}.`,
      });
    }

    if (expectedBlockedOutcomeType && value.candidateCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateCount"],
        message: "blocked preflight manifests must not persist candidateCount above 0.",
      });
    }

    if (expectedBlockedOutcomeType && value.candidates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "blocked preflight manifests must not persist candidate records.",
      });
    }

    if (expectedBlockedOutcomeType && value.rounds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rounds"],
        message: "blocked preflight manifests must not persist execution rounds.",
      });
    }

    if (expectedBlockedOutcomeType && value.recommendedWinner) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendedWinner"],
        message: "blocked preflight manifests cannot persist a recommended winner.",
      });
    }

    if (
      value.preflight?.decision === "proceed" &&
      value.outcome &&
      (value.outcome.type === "needs-clarification" ||
        value.outcome.type === "external-research-required" ||
        value.outcome.type === "abstained-before-execution")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome", "type"],
        message: "preflight decision proceed cannot persist a blocked preflight outcome type.",
      });
    }

    if (
      value.outcome &&
      value.profileSelection &&
      value.outcome.validationGapCount !== getValidationGaps(value.profileSelection).length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome", "validationGapCount"],
        message:
          "outcome.validationGapCount must match profileSelection validation gaps when a persisted profile selection is present.",
      });
    }

    if (value.candidates.length > 0 && value.candidateCount !== value.candidates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateCount"],
        message:
          "candidateCount must match the number of persisted candidates when candidate records are present.",
      });
    }

    if (value.outcome) {
      const persistedFinalistCount = value.candidates.filter(
        (candidate) => candidate.status === "promoted" || candidate.status === "exported",
      ).length;
      if (value.candidates.length > 0 && value.outcome.finalistCount !== persistedFinalistCount) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome", "finalistCount"],
          message:
            "outcome.finalistCount must match the number of promoted or exported candidates when candidate records are present.",
        });
      }

      if (value.status === "planned" && value.outcome.type !== "pending-execution") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome", "type"],
          message: "planned manifests must use the pending-execution outcome type.",
        });
      }

      if (value.status === "running" && value.outcome.type !== "running") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome", "type"],
          message: "running manifests must use the running outcome type.",
        });
      }

      if (
        value.status === "completed" &&
        (value.outcome.type === "pending-execution" || value.outcome.type === "running")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome", "type"],
          message: "completed manifests cannot use pending-execution or running outcome types.",
        });
      }
    }

    if (value.recommendedWinner && value.outcome?.type !== "recommended-survivor") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendedWinner"],
        message: "recommendedWinner is only allowed when outcome type is recommended-survivor.",
      });
    }

    if (
      value.recommendedWinner &&
      value.outcome?.recommendedCandidateId &&
      value.recommendedWinner.candidateId !== value.outcome.recommendedCandidateId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendedWinner", "candidateId"],
        message:
          "recommendedWinner.candidateId must match outcome.recommendedCandidateId when both are present.",
      });
    }

    const recommendedCandidateId =
      value.outcome?.recommendedCandidateId ?? value.recommendedWinner?.candidateId;
    if (recommendedCandidateId) {
      const recommendedCandidate = value.candidates.find(
        (candidate) => candidate.id === recommendedCandidateId,
      );
      if (!recommendedCandidate && value.candidates.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates"],
          message:
            "recommended survivors must reference a persisted candidate when candidate records are present in the manifest.",
        });
      }
      if (
        recommendedCandidate &&
        recommendedCandidate.status !== "promoted" &&
        recommendedCandidate.status !== "exported"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates"],
          message:
            "recommended survivors must reference a promoted or exported candidate when that candidate is present in the manifest.",
        });
      }
    }
  });

export const exportPlanSchema = z
  .object({
    runId: z.string().min(1),
    winnerId: z.string().min(1),
    branchName: optionalNonEmptyStringSchema,
    materializationLabel: optionalNonEmptyStringSchema,
    mode: exportModeSchema,
    workspaceDir: z.string().min(1),
    patchPath: z.string().min(1).optional(),
    appliedPathCount: z.number().int().min(0).optional(),
    removedPathCount: z.number().int().min(0).optional(),
    withReport: z.boolean(),
    reportBundle: reportBundleSchema.optional(),
    createdAt: z.string().min(1),
  })
  .superRefine((plan, context) => {
    if (plan.mode === "git-branch" && !plan.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch exports must include branchName.",
        path: ["branchName"],
      });
    }
  });

export const latestRunStateSchema = z.object({
  runId: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type CandidateManifest = z.infer<typeof candidateManifestSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunRound = z.infer<typeof roundManifestSchema>;
export type RunRecommendation = z.infer<typeof runRecommendationSchema>;
export type ConsultationOutcome = z.infer<typeof consultationOutcomeSchema>;
export type ConsultationPreflight = z.infer<typeof consultationPreflightSchema>;
export type ConsultationResearchBrief = z.infer<typeof consultationResearchBriefSchema>;
export type SavedConsultationStatus = z.infer<typeof savedConsultationStatusSchema>;
export type ConsultationNextAction = z.infer<typeof consultationNextActionSchema>;
export type ExportPlan = z.infer<typeof exportPlanSchema>;
export type LatestRunState = z.infer<typeof latestRunStateSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type ExportMode = z.infer<typeof exportModeSchema>;

interface ConsultationOutcomeInput {
  candidates: Array<Pick<CandidateManifest, "status">>;
  rounds?: Array<Pick<RunRound, "id" | "status" | "verdictCount">>;
  profileSelection?: {
    validationGaps?: string[] | undefined;
    missingCapabilities?: string[] | undefined;
    oracleIds: string[];
  };
  recommendedWinner?: Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">;
  status: z.infer<typeof runStatusSchema>;
}

interface ConsultationOutcomeManifestInput {
  status: z.infer<typeof runStatusSchema>;
  candidates: Array<Pick<CandidateManifest, "status">>;
  rounds?: Array<Pick<RunRound, "id" | "status" | "verdictCount">> | undefined;
  profileSelection?:
    | {
        validationGaps?: string[] | undefined;
        missingCapabilities?: string[] | undefined;
        oracleIds: string[];
      }
    | undefined;
  recommendedWinner?:
    | Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">
    | undefined;
}

export function deriveConsultationOutcome(input: ConsultationOutcomeInput): ConsultationOutcome {
  const finalistCount = input.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  ).length;
  const validationGapCount = getValidationGaps(input.profileSelection).length;
  const verificationLevel = deriveVerificationLevel(input.rounds, validationGapCount);
  const judgingBasisKind =
    (input.profileSelection?.oracleIds.length ?? 0) > 0
      ? "repo-local-oracle"
      : validationGapCount > 0
        ? "missing-capability"
        : "unknown";
  const validationPosture =
    validationGapCount > 0 ? "validation-gaps" : input.profileSelection ? "sufficient" : "unknown";

  if (input.status === "planned") {
    return {
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (input.status === "running") {
    return {
      type: "running",
      terminal: false,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (input.recommendedWinner) {
    return {
      type: "recommended-survivor",
      terminal: true,
      crownable: true,
      finalistCount,
      recommendedCandidateId: input.recommendedWinner.candidateId,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (finalistCount > 0) {
    return {
      type: "finalists-without-recommendation",
      terminal: true,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  if (validationGapCount > 0) {
    return {
      type: "completed-with-validation-gaps",
      terminal: true,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      validationGapCount,
      judgingBasisKind,
    };
  }

  return {
    type: "no-survivors",
    terminal: true,
    crownable: false,
    finalistCount,
    validationPosture,
    verificationLevel,
    validationGapCount,
    judgingBasisKind,
  };
}

export function deriveConsultationOutcomeForManifest(
  manifest: ConsultationOutcomeManifestInput,
): ConsultationOutcome {
  return deriveConsultationOutcome({
    status: manifest.status,
    candidates: manifest.candidates,
    ...(manifest.rounds ? { rounds: manifest.rounds } : {}),
    ...(manifest.profileSelection
      ? {
          profileSelection: {
            validationGaps: getValidationGaps(manifest.profileSelection),
            oracleIds: manifest.profileSelection.oracleIds,
          },
        }
      : {}),
    ...(manifest.recommendedWinner
      ? {
          recommendedWinner: {
            candidateId: manifest.recommendedWinner.candidateId,
          },
        }
      : {}),
  });
}

export function buildSavedConsultationStatus(manifest: RunManifest): SavedConsultationStatus {
  const outcome = manifest.outcome ?? deriveConsultationOutcomeForManifest(manifest);
  const nextActions = buildConsultationNextActions(outcome, {
    researchBasisDrift: manifest.preflight?.researchBasisDrift === true,
  });
  const researchRerunInputPath =
    manifest.taskPacket.sourceKind === "research-brief"
      ? manifest.taskPacket.sourcePath
      : undefined;
  const researchRerunRecommended =
    outcome.type === "external-research-required" ||
    manifest.preflight?.researchBasisDrift === true;

  return savedConsultationStatusSchema.parse({
    consultationId: manifest.id,
    consultationState: manifest.status,
    outcomeType: outcome.type,
    terminal: outcome.terminal,
    crownable: outcome.crownable,
    taskSourceKind: manifest.taskPacket.sourceKind,
    taskSourcePath: manifest.taskPacket.sourcePath,
    ...(manifest.taskPacket.artifactKind
      ? { taskArtifactKind: manifest.taskPacket.artifactKind }
      : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
      : {}),
    ...(manifest.taskPacket.researchContext?.confidence
      ? { researchConfidence: manifest.taskPacket.researchContext.confidence }
      : {}),
    researchSignalCount: manifest.taskPacket.researchContext?.signalSummary.length ?? 0,
    ...(manifest.taskPacket.researchContext?.signalFingerprint
      ? { researchSignalFingerprint: manifest.taskPacket.researchContext.signalFingerprint }
      : {}),
    ...(manifest.preflight?.researchBasisDrift !== undefined
      ? { researchBasisDrift: manifest.preflight.researchBasisDrift }
      : {}),
    researchRerunRecommended,
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    researchConflictsPresent:
      (manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0) > 0,
    ...(manifest.taskPacket.originKind && manifest.taskPacket.originPath
      ? {
          taskOriginSourceKind: manifest.taskPacket.originKind,
          taskOriginSourcePath: manifest.taskPacket.originPath,
        }
      : {}),
    validationPosture: outcome.validationPosture,
    ...(getValidationProfileId(manifest.profileSelection)
      ? { validationProfileId: getValidationProfileId(manifest.profileSelection) }
      : {}),
    ...(getValidationSummary(manifest.profileSelection)
      ? { validationSummary: getValidationSummary(manifest.profileSelection) }
      : {}),
    validationSignals: getValidationSignals(manifest.profileSelection),
    validationGaps: getValidationGaps(manifest.profileSelection),
    ...(outcome.recommendedCandidateId
      ? { recommendedCandidateId: outcome.recommendedCandidateId }
      : {}),
    finalistCount: outcome.finalistCount,
    validationGapsPresent: outcome.validationGapCount > 0,
    judgingBasisKind: outcome.judgingBasisKind,
    verificationLevel: outcome.verificationLevel,
    ...(manifest.preflight ? { preflightDecision: manifest.preflight.decision } : {}),
    researchPosture: manifest.preflight?.researchPosture ?? "unknown",
    nextActions,
    updatedAt: manifest.updatedAt ?? manifest.createdAt,
  });
}

export function buildBlockedPreflightOutcome(
  preflight: ConsultationPreflight,
): ConsultationOutcome {
  if (preflight.decision === "needs-clarification") {
    return {
      type: "needs-clarification",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "unknown",
      verificationLevel: "none",
      validationGapCount: 0,
      judgingBasisKind: "unknown",
    };
  }

  if (preflight.decision === "external-research-required") {
    return {
      type: "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "validation-gaps",
      verificationLevel: "none",
      validationGapCount: 0,
      judgingBasisKind: "unknown",
    };
  }

  return {
    type: "abstained-before-execution",
    terminal: true,
    crownable: false,
    finalistCount: 0,
    validationPosture: "unknown",
    verificationLevel: "none",
    validationGapCount: 0,
    judgingBasisKind: "unknown",
  };
}

export function isPreflightBlockedConsultation(manifest: Pick<RunManifest, "preflight">): boolean {
  return (
    manifest.preflight?.decision === "needs-clarification" ||
    manifest.preflight?.decision === "external-research-required" ||
    manifest.preflight?.decision === "abstain"
  );
}

function deriveVerificationLevel(
  rounds: ConsultationOutcomeInput["rounds"],
  validationGapCount: number,
): z.infer<typeof consultationVerificationLevelSchema> {
  const completedRounds = new Set(
    (rounds ?? [])
      .filter((round) => round.status === "completed" && round.verdictCount > 0)
      .map((round) => round.id),
  );

  if (completedRounds.size === 0) {
    return "none";
  }

  if (completedRounds.has("deep") && validationGapCount === 0) {
    return "thorough";
  }

  if (completedRounds.has("impact") || completedRounds.has("deep")) {
    return "standard";
  }

  return "lightweight";
}

function buildConsultationNextActions(
  outcome: ConsultationOutcome,
  options?: { researchBasisDrift?: boolean },
): ConsultationNextAction[] {
  const actions = new Set<ConsultationNextAction>(["reopen-verdict", "browse-archive"]);

  switch (outcome.type) {
    case "needs-clarification":
      actions.add("review-preflight-readiness");
      actions.add("answer-clarification-and-rerun");
      break;
    case "external-research-required":
      actions.add("review-preflight-readiness");
      actions.add("gather-external-research-and-rerun");
      actions.add("rerun-with-research-brief");
      break;
    case "abstained-before-execution":
      actions.add("review-preflight-readiness");
      actions.add("revise-task-and-rerun");
      break;
    case "recommended-survivor":
      actions.add("crown-recommended-survivor");
      break;
    case "finalists-without-recommendation":
      actions.add("inspect-comparison-report");
      actions.add("rerun-with-different-candidate-count");
      break;
    case "completed-with-validation-gaps":
      actions.add("inspect-comparison-report");
      actions.add("review-validation-gaps");
      actions.add("add-repo-local-oracle");
      actions.add("rerun-with-different-candidate-count");
      break;
    case "no-survivors":
      actions.add("inspect-comparison-report");
      actions.add("rerun-with-different-candidate-count");
      break;
    case "pending-execution":
    case "running":
      break;
  }

  if (outcome.validationGapCount > 0) {
    actions.add("review-validation-gaps");
    actions.add("add-repo-local-oracle");
  }
  if (options?.researchBasisDrift) {
    actions.add("refresh-stale-research-and-rerun");
  }

  return [...actions];
}
