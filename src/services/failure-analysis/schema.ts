import { z } from "zod";

import { candidateStatusSchema } from "../../domain/run.js";

export const failureAnalysisSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  trigger: z.enum([
    "judge-abstained",
    "repair-stalled",
    "validation-gaps",
    "no-survivors",
    "finalists-without-recommendation",
  ]),
  summary: z.string().min(1),
  recommendedAction: z.literal("investigate-root-cause-before-rerun"),
  validationGaps: z.array(z.string().min(1)).default([]),
  candidates: z.array(
    z.object({
      candidateId: z.string().min(1),
      status: candidateStatusSchema,
      repairCount: z.number().int().min(0),
      repairedRounds: z.array(z.string().min(1)).default([]),
      topFailingOracleIds: z.array(z.string().min(1)).default([]),
      keyWitnessTitles: z.array(z.string().min(1)).default([]),
    }),
  ),
});
