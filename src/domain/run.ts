import { z } from "zod";

import { adapterSchema } from "./config.js";

export const candidateStatusSchema = z.enum([
  "planned",
  "running",
  "judged",
  "eliminated",
  "promoted",
  "exported",
]);

export const candidateManifestSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  strategyLabel: z.string().min(1),
  status: candidateStatusSchema,
  workspaceDir: z.string().min(1),
  createdAt: z.string().min(1),
});

export const runStatusSchema = z.enum(["planned", "running", "completed"]);

export const runManifestSchema = z.object({
  id: z.string().min(1),
  status: runStatusSchema,
  taskPath: z.string().min(1),
  agent: adapterSchema,
  candidateCount: z.number().int().min(1),
  createdAt: z.string().min(1),
  rounds: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
  candidates: z.array(candidateManifestSchema).min(1),
});

export const exportPlanSchema = z.object({
  runId: z.string().min(1),
  winnerId: z.string().min(1),
  branchName: z.string().min(1),
  withReport: z.boolean(),
  createdAt: z.string().min(1),
});

export type CandidateManifest = z.infer<typeof candidateManifestSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type ExportPlan = z.infer<typeof exportPlanSchema>;
