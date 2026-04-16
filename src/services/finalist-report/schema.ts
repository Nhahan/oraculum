import { z } from "zod";

import { finalistSummarySchema } from "../../adapters/types.js";
import { consultationProfileSelectionSchema } from "../../domain/profile.js";
import {
  candidateStatusSchema,
  consultationVerificationLevelSchema,
  runRecommendationSchema,
} from "../../domain/run.js";
import { taskPacketSummarySchema } from "../../domain/task.js";

export const comparisonReportSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  agent: z.string().min(1),
  task: taskPacketSummarySchema,
  targetResultLabel: z.string().min(1),
  finalistCount: z.number().int().min(0),
  recommendedWinner: runRecommendationSchema.optional(),
  whyThisWon: z.string().min(1).optional(),
  validationProfileId: z.string().min(1).optional(),
  validationSummary: z.string().min(1).optional(),
  validationSignals: z.array(z.string().min(1)).default([]),
  validationGaps: z.array(z.string().min(1)).default([]),
  researchBasisStatus: z.enum(["current", "stale", "unknown"]).default("unknown"),
  researchConflictHandling: z.enum(["accepted", "manual-review-required"]).optional(),
  researchBasisDrift: z.boolean().optional(),
  researchRerunRecommended: z.boolean(),
  researchRerunInputPath: z.string().min(1).optional(),
  consultationProfile: consultationProfileSelectionSchema.optional(),
  verificationLevel: consultationVerificationLevelSchema,
  finalists: z.array(
    finalistSummarySchema.extend({
      status: candidateStatusSchema,
      verdictCounts: z.object({
        pass: z.number().int().min(0),
        repairable: z.number().int().min(0),
        fail: z.number().int().min(0),
        skip: z.number().int().min(0),
        info: z.number().int().min(0),
        warning: z.number().int().min(0),
        error: z.number().int().min(0),
        critical: z.number().int().min(0),
      }),
    }),
  ),
});

export type ComparisonReport = z.infer<typeof comparisonReportSchema>;
