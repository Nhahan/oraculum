import { z } from "zod";

import { runManifestSchema, savedConsultationStatusSchema } from "../../run.js";
import { artifactDiagnosticSchema, consultationArtifactPathsSchema } from "../common.js";
import { verdictReviewSchema } from "./review.js";

export const verdictActionResponseSchema = z.object({
  mode: z.literal("verdict"),
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  review: verdictReviewSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  artifactDiagnostics: z.array(artifactDiagnosticSchema).optional(),
});

export type VerdictActionResponse = z.infer<typeof verdictActionResponseSchema>;
