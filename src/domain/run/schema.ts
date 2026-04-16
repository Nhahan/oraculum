import { z } from "zod";

import { adapterSchema, roundIdSchema } from "../config.js";
import {
  consultationProfileSelectionSchema,
  decisionConfidenceSchema,
  getValidationGaps,
  profileRepoSignalsSchema,
} from "../profile.js";
import {
  deriveResearchConflictHandling,
  materializedTaskPacketSchema,
  taskPacketSummarySchema,
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
  taskSourceKindSchema,
} from "../task.js";

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
export const clarifyPressureKindSchema = z.enum(["clarify-needed", "external-research-required"]);
export const clarifyScopeKeyTypeSchema = z.enum(["target-artifact", "task-source"]);
export const consultationNextActionSchema = z.preprocess(
  (value) => (value === "crown-recommended-survivor" ? "crown-recommended-result" : value),
  z.enum([
    "reopen-verdict",
    "browse-archive",
    "perform-manual-review",
    "review-preflight-readiness",
    "answer-clarification-and-rerun",
    "gather-external-research-and-rerun",
    "rerun-with-research-brief",
    "refresh-stale-research-and-rerun",
    "revise-task-and-rerun",
    "crown-recommended-result",
    "inspect-comparison-report",
    "review-validation-gaps",
    "add-repo-local-oracle",
    "rerun-with-different-candidate-count",
  ]),
);

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
export const exportMaterializationModeSchema = z.enum(["branch", "workspace-sync"]);
export const optionalNonEmptyStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

function deriveExportModeFromMaterializationMode(
  materializationMode: z.infer<typeof exportMaterializationModeSchema>,
): z.infer<typeof exportModeSchema> {
  return materializationMode === "branch" ? "git-branch" : "workspace-sync";
}

function deriveExportMaterializationMode(
  mode: z.infer<typeof exportModeSchema>,
): z.infer<typeof exportMaterializationModeSchema> {
  return mode === "git-branch" ? "branch" : "workspace-sync";
}

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
export const consultationPreflightSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = { ...(value as Record<string, unknown>) };
    if (payload.researchBasisDrift === null) {
      delete payload.researchBasisDrift;
    }
    if (payload.clarificationQuestion === null) {
      delete payload.clarificationQuestion;
    }
    if (payload.researchQuestion === null) {
      delete payload.researchQuestion;
    }
    return payload;
  },
  z
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
    }),
);
export const consultationClarifyFollowUpSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  decision: z.enum(["needs-clarification", "external-research-required"]),
  scopeKeyType: clarifyScopeKeyTypeSchema,
  scopeKey: z.string().min(1),
  repeatedCaseCount: z.number().int().min(2),
  repeatedKinds: z.array(clarifyPressureKindSchema).min(1),
  recurringReasons: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  keyQuestion: z.string().min(1),
  missingResultContract: z.string().min(1),
  missingJudgingBasis: z.string().min(1),
});
export const consultationPreflightReadinessArtifactSchema = z
  .object({
    runId: z.string().min(1),
    signals: profileRepoSignalsSchema,
    recommendation: consultationPreflightSchema,
    llmSkipped: z.boolean().optional(),
    llmFailure: z.string().min(1).optional(),
    llmResult: z.unknown().optional(),
    researchBasis: z
      .object({
        acceptedSignalFingerprint: z.string().min(1),
        currentSignalFingerprint: z.string().min(1).optional(),
        driftDetected: z.boolean(),
        status: taskResearchBasisStatusSchema,
        refreshAction: z.enum(["refresh-before-rerun", "reuse"]),
      })
      .optional(),
    clarifyFollowUp: consultationClarifyFollowUpSchema.optional(),
  })
  .passthrough();
export const consultationResearchBriefSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = value as Record<string, unknown>;
    const unresolvedConflicts = Array.isArray(payload.unresolvedConflicts)
      ? payload.unresolvedConflicts.filter((entry): entry is string => typeof entry === "string")
      : [];

    return {
      ...payload,
      ...(typeof payload.conflictHandling === "string"
        ? {}
        : { conflictHandling: deriveResearchConflictHandling(unresolvedConflicts) }),
    };
  },
  z
    .object({
      runId: z.string().min(1),
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
      conflictHandling: taskResearchConflictHandlingSchema,
      notes: z.array(z.string().min(1)).default([]),
      signalSummary: z.array(z.string().min(1)).default([]),
      signalFingerprint: z.string().min(1).optional(),
    })
    .superRefine((value, context) => {
      const expectedHandling = deriveResearchConflictHandling(value.unresolvedConflicts);
      if (value.conflictHandling !== expectedHandling) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflictHandling"],
          message:
            "conflictHandling must match unresolvedConflicts: use manual-review-required when conflicts exist, otherwise accepted.",
        });
      }
    }),
);
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
  availableOracleIds: z.array(z.string().min(1)).default([]),
  createdFromProfileId: z.string().min(1).optional(),
  createdFromPreflightDecision: consultationPreflightDecisionSchema.optional(),
});
export const consultationPlanWorkstreamSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  goal: z.string().min(1),
  targetArtifacts: z.array(z.string().min(1)).default([]),
  requiredChangedPaths: z.array(z.string().min(1)).default([]),
  protectedPaths: z.array(z.string().min(1)).default([]),
  oracleIds: z.array(z.string().min(1)).default([]),
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
  candidateId: z.string().min(1),
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
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  finalists: z.array(finalistScorecardSchema).default([]),
});
export const consultationPlanArtifactSchema = z.object({
  runId: z.string().min(1),
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
  oracleIds: z.array(z.string().min(1)).default([]),
  requiredChangedPaths: z.array(z.string().min(1)).default([]),
  protectedPaths: z.array(z.string().min(1)).default([]),
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
    const hasPersistedResearchContext =
      (typeof payload.researchSignalCount === "number" && payload.researchSignalCount > 0) ||
      typeof payload.researchSignalFingerprint === "string" ||
      typeof payload.researchConfidence === "string" ||
      typeof payload.researchRerunInputPath === "string" ||
      payload.researchConflictsPresent === true ||
      typeof payload.researchConflictHandling === "string";
    const researchConflictHandling =
      typeof payload.researchConflictHandling === "string"
        ? payload.researchConflictHandling
        : hasPersistedResearchContext
          ? deriveResearchConflictHandling(
              payload.researchConflictsPresent === true ? ["persisted-conflict"] : [],
            )
          : undefined;
    const researchBasisStatus =
      typeof payload.researchBasisStatus === "string"
        ? payload.researchBasisStatus
        : payload.researchBasisDrift === true
          ? "stale"
          : hasPersistedResearchContext
            ? "current"
            : "unknown";

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
      researchBasisStatus,
      ...(researchConflictHandling ? { researchConflictHandling } : {}),
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
      researchBasisStatus: taskResearchBasisStatusSchema,
      researchConflictHandling: taskResearchConflictHandlingSchema.optional(),
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

export const exportPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = value as Record<string, unknown>;
    const mode = typeof payload.mode === "string" ? payload.mode : undefined;
    const materializationMode =
      typeof payload.materializationMode === "string" ? payload.materializationMode : undefined;
    const patchPath = typeof payload.patchPath === "string" ? payload.patchPath : undefined;
    const materializationPatchPath =
      typeof payload.materializationPatchPath === "string"
        ? payload.materializationPatchPath
        : undefined;

    return {
      ...payload,
      ...(mode
        ? { mode }
        : materializationMode
          ? {
              mode: deriveExportModeFromMaterializationMode(
                materializationMode as z.infer<typeof exportMaterializationModeSchema>,
              ),
            }
          : {}),
      ...(materializationMode
        ? { materializationMode }
        : mode
          ? {
              materializationMode: deriveExportMaterializationMode(
                mode as z.infer<typeof exportModeSchema>,
              ),
            }
          : {}),
      ...(patchPath
        ? { patchPath }
        : materializationPatchPath
          ? { patchPath: materializationPatchPath }
          : {}),
      ...(materializationPatchPath
        ? { materializationPatchPath }
        : patchPath
          ? { materializationPatchPath: patchPath }
          : {}),
    };
  },
  z
    .object({
      runId: z.string().min(1),
      winnerId: z.string().min(1),
      branchName: optionalNonEmptyStringSchema,
      materializationLabel: optionalNonEmptyStringSchema,
      mode: exportModeSchema,
      materializationMode: exportMaterializationModeSchema,
      workspaceDir: z.string().min(1),
      patchPath: z.string().min(1).optional(),
      materializationPatchPath: z.string().min(1).optional(),
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

      if (plan.materializationMode !== deriveExportMaterializationMode(plan.mode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["materializationMode"],
          message:
            "materializationMode must match mode when both legacy and canonical export fields are present.",
        });
      }

      if (
        plan.patchPath !== undefined &&
        plan.materializationPatchPath !== undefined &&
        plan.patchPath !== plan.materializationPatchPath
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["materializationPatchPath"],
          message:
            "materializationPatchPath must match patchPath when both legacy and canonical export fields are present.",
        });
      }
    }),
);

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
export type ConsultationClarifyFollowUp = z.infer<typeof consultationClarifyFollowUpSchema>;
export type ConsultationPreflightReadinessArtifact = z.infer<
  typeof consultationPreflightReadinessArtifactSchema
>;
export type ConsultationResearchBrief = z.infer<typeof consultationResearchBriefSchema>;
export type ConsultationPlanArtifact = z.infer<typeof consultationPlanArtifactSchema>;
export type ConsultationPlanWorkstream = z.infer<typeof consultationPlanWorkstreamSchema>;
export type ConsultationPlanStage = z.infer<typeof consultationPlanStageSchema>;
export type CandidateScorecardStageResult = z.infer<typeof candidateScorecardStageResultSchema>;
export type CandidateScorecard = z.infer<typeof candidateScorecardSchema>;
export type FinalistScorecard = z.infer<typeof finalistScorecardSchema>;
export type FinalistScorecardBundle = z.infer<typeof finalistScorecardBundleSchema>;
export type SavedConsultationStatus = z.infer<typeof savedConsultationStatusSchema>;
export type ConsultationNextAction = z.infer<typeof consultationNextActionSchema>;
export type ExportPlan = z.infer<typeof exportPlanSchema>;
export type LatestRunState = z.infer<typeof latestRunStateSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type ExportMode = z.infer<typeof exportModeSchema>;
export type ExportMaterializationMode = z.infer<typeof exportMaterializationModeSchema>;
