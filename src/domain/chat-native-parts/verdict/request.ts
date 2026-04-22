import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";

export const verdictToolRequestSchema = z
  .object({
    cwd: z.string().min(1),
    consultationId: artifactPathSegmentSchema.optional(),
  })
  .strict();

export const verdictArchiveToolRequestSchema = z
  .object({
    cwd: z.string().min(1),
    count: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export type VerdictToolRequest = z.infer<typeof verdictToolRequestSchema>;
export type VerdictArchiveToolRequest = z.infer<typeof verdictArchiveToolRequestSchema>;
