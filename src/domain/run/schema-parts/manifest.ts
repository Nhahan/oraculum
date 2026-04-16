import { z } from "zod";

import { adapterSchema } from "../../config.js";
import { consultationProfileSelectionSchema, getValidationGaps } from "../../profile.js";
import { taskPacketSummarySchema } from "../../task.js";
import { consultationOutcomeSchema, consultationPreflightSchema } from "./consultation.js";
import {
  candidateManifestSchema,
  roundManifestSchema,
  runRecommendationSchema,
} from "./execution.js";
import { getBlockedOutcomeType, runStatusSchema } from "./shared.js";

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
