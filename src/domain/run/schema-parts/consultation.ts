import { z } from "zod";

import { adapterSchema } from "../../config.js";
import { decisionConfidenceSchema, profileRepoSignalsSchema } from "../../profile.js";
import {
  deriveResearchConflictHandling,
  taskPacketSummarySchema,
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
} from "../../task.js";
import {
  clarifyPressureKindSchema,
  clarifyScopeKeyTypeSchema,
  consultationJudgingBasisKindSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  getExpectedOutcomeFlags,
} from "./shared.js";

export const consultationOutcomeSchema = z
  .object({
    type: consultationOutcomeTypeSchema,
    terminal: z.boolean(),
    crownable: z.boolean(),
    finalistCount: z.number().int().min(0),
    recommendedCandidateId: z.string().min(1).optional(),
    validationPosture: consultationValidationPostureSchema,
    verificationLevel: consultationVerificationLevelSchema,
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
  });

export const consultationPreflightSchema = z
  .object({
    decision: consultationPreflightDecisionSchema,
    confidence: decisionConfidenceSchema,
    summary: z.string().min(1),
    researchPosture: consultationResearchPostureSchema,
    researchBasisDrift: z.boolean().optional(),
    clarificationQuestion: z.string().min(1).nullable().optional(),
    researchQuestion: z.string().min(1).nullable().optional(),
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

export const consultationResearchBriefSchema = z
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
  });
