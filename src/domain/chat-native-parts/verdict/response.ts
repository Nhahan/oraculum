import { z } from "zod";

import { runManifestSchema, savedConsultationStatusSchema } from "../../run.js";
import { consultationArtifactPathsSchema } from "../common.js";
import { verdictReviewSchema } from "./review.js";

export const verdictToolResponseSchema = z.object({
  mode: z.literal("verdict"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  review: verdictReviewSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
});

export const verdictArchiveToolResponseSchema = z.object({
  mode: z.literal("verdict-archive"),
  consultations: z.array(runManifestSchema),
  archive: z.string().min(1),
});

export type VerdictToolResponse = z.infer<typeof verdictToolResponseSchema>;
export type VerdictArchiveToolResponse = z.infer<typeof verdictArchiveToolResponseSchema>;
