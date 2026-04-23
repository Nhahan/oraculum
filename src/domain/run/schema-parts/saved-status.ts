import { z } from "zod";

import { decisionConfidenceSchema } from "../../profile.js";
import {
  taskResearchBasisStatusSchema,
  taskResearchConflictHandlingSchema,
  taskSourceKindSchema,
} from "../../task.js";
import {
  consultationJudgingBasisKindSchema,
  consultationNextActionSchema,
  consultationOutcomeTypeSchema,
  consultationPreflightDecisionSchema,
  consultationResearchPostureSchema,
  consultationValidationPostureSchema,
  consultationVerificationLevelSchema,
  getBlockedOutcomeType,
  getExpectedOutcomeFlags,
  runStatusSchema,
} from "./shared.js";

export const savedConsultationStatusSchema = z
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
  });
