import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";

export const verdictActionRequestSchema = z
  .object({
    cwd: z.string().min(1),
    consultationId: artifactPathSegmentSchema.optional(),
  })
  .strict();

export type VerdictActionRequest = z.infer<typeof verdictActionRequestSchema>;
