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
export const consultationOutcomeSchema = z.object({
  type: consultationOutcomeTypeSchema,
  terminal: z.boolean(),
  crownable: z.boolean(),
  finalistCount: z.number().int().min(0),
  recommendedCandidateId: z.string().min(1).optional(),
  validationPosture: consultationValidationPostureSchema,
  verificationLevel: consultationVerificationLevelSchema,
  missingCapabilityCount: z.number().int().min(0),
  judgingBasisKind: consultationJudgingBasisKindSchema,
});
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
export const savedConsultationStatusSchema = z.object({
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
  missingCapabilitiesPresent: z.boolean(),
  judgingBasisKind: consultationJudgingBasisKindSchema,
  verificationLevel: consultationVerificationLevelSchema,
  preflightDecision: consultationPreflightDecisionSchema.optional(),
  researchPosture: consultationResearchPostureSchema,
  nextActions: z.array(consultationNextActionSchema).default([]),
  updatedAt: z.string().min(1),
});

export const runManifestSchema = z.object({
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
  profileSelection?: Pick<
    NonNullable<RunManifest["profileSelection"]>,
    "missingCapabilities" | "oracleIds"
  >;
  recommendedWinner?: Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">;
  status: z.infer<typeof runStatusSchema>;
}

interface ConsultationOutcomeManifestInput {
  status: z.infer<typeof runStatusSchema>;
  candidates: Array<Pick<CandidateManifest, "status">>;
  rounds?: Array<Pick<RunRound, "id" | "status" | "verdictCount">> | undefined;
  profileSelection?:
    | Pick<NonNullable<RunManifest["profileSelection"]>, "missingCapabilities" | "oracleIds">
    | undefined;
  recommendedWinner?:
    | Pick<NonNullable<RunManifest["recommendedWinner"]>, "candidateId">
    | undefined;
}

export function deriveConsultationOutcome(input: ConsultationOutcomeInput): ConsultationOutcome {
  const finalistCount = input.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  ).length;
  const missingCapabilityCount = input.profileSelection?.missingCapabilities.length ?? 0;
  const verificationLevel = deriveVerificationLevel(input.rounds, missingCapabilityCount);
  const judgingBasisKind =
    (input.profileSelection?.oracleIds.length ?? 0) > 0
      ? "repo-local-oracle"
      : missingCapabilityCount > 0
        ? "missing-capability"
        : "unknown";
  const validationPosture =
    missingCapabilityCount > 0
      ? "validation-gaps"
      : input.profileSelection
        ? "sufficient"
        : "unknown";

  if (input.status === "planned") {
    return {
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      missingCapabilityCount,
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
      missingCapabilityCount,
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
      missingCapabilityCount,
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
      missingCapabilityCount,
      judgingBasisKind,
    };
  }

  if (missingCapabilityCount > 0) {
    return {
      type: "completed-with-validation-gaps",
      terminal: true,
      crownable: false,
      finalistCount,
      validationPosture,
      verificationLevel,
      missingCapabilityCount,
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
    missingCapabilityCount,
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
            missingCapabilities: getValidationGaps(manifest.profileSelection),
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
    missingCapabilitiesPresent: outcome.missingCapabilityCount > 0,
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
      missingCapabilityCount: 0,
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
      missingCapabilityCount: 0,
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
    missingCapabilityCount: 0,
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
  missingCapabilityCount: number,
): z.infer<typeof consultationVerificationLevelSchema> {
  const completedRounds = new Set(
    (rounds ?? [])
      .filter((round) => round.status === "completed" && round.verdictCount > 0)
      .map((round) => round.id),
  );

  if (completedRounds.size === 0) {
    return "none";
  }

  if (completedRounds.has("deep") && missingCapabilityCount === 0) {
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

  if (outcome.missingCapabilityCount > 0) {
    actions.add("review-validation-gaps");
    actions.add("add-repo-local-oracle");
  }
  if (options?.researchBasisDrift) {
    actions.add("refresh-stale-research-and-rerun");
  }

  return [...actions];
}
