import { z } from "zod";

import { artifactPathSegmentSchema } from "./artifact-id.js";
import { roundIdSchema } from "./config.js";

export const witnessKindSchema = z.enum([
  "command-output",
  "diff",
  "file",
  "log",
  "metric",
  "policy",
  "test",
  "trace",
]);

export const verdictStatusSchema = z.enum(["pass", "repairable", "fail", "skip"]);
export const verdictSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export const verdictConfidenceSchema = z.enum(["low", "medium", "high"]);

export const witnessSchema = z.object({
  id: artifactPathSegmentSchema,
  kind: witnessKindSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  path: z.string().min(1).optional(),
  excerpt: z.string().min(1).optional(),
  scope: z.array(z.string().min(1)).default([]),
});

export const oracleVerdictSchema = z.object({
  oracleId: artifactPathSegmentSchema,
  roundId: roundIdSchema,
  status: verdictStatusSchema,
  severity: verdictSeveritySchema,
  summary: z.string().min(1),
  invariant: z.string().min(1),
  confidence: verdictConfidenceSchema,
  repairHint: z.string().min(1).optional(),
  affectedScope: z.array(z.string().min(1)).default([]),
  witnesses: z.array(witnessSchema).default([]),
});

export type Witness = z.infer<typeof witnessSchema>;
export type OracleVerdict = z.infer<typeof oracleVerdictSchema>;
