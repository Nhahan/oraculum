import { z } from "zod";

export const verdictToolRequestSchema = z.object({
  cwd: z.string().min(1),
  consultationId: z.string().min(1).optional(),
});

export const verdictArchiveToolRequestSchema = z.object({
  cwd: z.string().min(1),
  count: z.number().int().min(1).optional(),
});

export type VerdictToolRequest = z.infer<typeof verdictToolRequestSchema>;
export type VerdictArchiveToolRequest = z.infer<typeof verdictArchiveToolRequestSchema>;
