import { z } from "zod";

import { adapterSchema, roundIdSchema } from "./config.js";
import { taskPacketSummarySchema } from "./task.js";

export const candidateStatusSchema = z.enum([
  "planned",
  "running",
  "executed",
  "failed",
  "judged",
  "eliminated",
  "promoted",
  "exported",
]);

export const workspaceModeSchema = z.enum(["copy", "git-worktree"]);
export const roundExecutionStatusSchema = z.enum(["pending", "running", "completed"]);

export const candidateManifestSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  strategyLabel: z.string().min(1),
  status: candidateStatusSchema,
  workspaceDir: z.string().min(1),
  taskPacketPath: z.string().min(1),
  lastRunResultPath: z.string().min(1).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  baseRevision: z.string().min(1).optional(),
  baseSnapshotPath: z.string().min(1).optional(),
  repairCount: z.number().int().min(0).default(0),
  repairedRounds: z.array(roundIdSchema).default([]),
  createdAt: z.string().min(1),
});

export const runStatusSchema = z.enum(["planned", "running", "completed"]);
export const roundManifestSchema = z.object({
  id: roundIdSchema,
  label: z.string().min(1),
  status: roundExecutionStatusSchema,
  verdictCount: z.number().int().min(0),
  survivorCount: z.number().int().min(0),
  eliminatedCount: z.number().int().min(0),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
});

export const runRecommendationSchema = z.object({
  candidateId: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  source: z.enum(["llm-judge", "fallback-policy"]),
});

export const reportBundleSchema = z.object({
  rootDir: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
});

export const exportModeSchema = z.enum(["git-branch", "workspace-sync"]);

export const runManifestSchema = z.object({
  id: z.string().min(1),
  status: runStatusSchema,
  taskPath: z.string().min(1),
  taskPacket: taskPacketSummarySchema,
  agent: adapterSchema,
  candidateCount: z.number().int().min(1),
  createdAt: z.string().min(1),
  rounds: z.array(roundManifestSchema).min(1),
  candidates: z.array(candidateManifestSchema).min(1),
  recommendedWinner: runRecommendationSchema.optional(),
});

export const exportPlanSchema = z.object({
  runId: z.string().min(1),
  winnerId: z.string().min(1),
  branchName: z.string().min(1),
  mode: exportModeSchema,
  workspaceDir: z.string().min(1),
  patchPath: z.string().min(1).optional(),
  appliedPathCount: z.number().int().min(0).optional(),
  removedPathCount: z.number().int().min(0).optional(),
  withReport: z.boolean(),
  reportBundle: reportBundleSchema.optional(),
  createdAt: z.string().min(1),
});

export const latestRunStateSchema = z.object({
  runId: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type CandidateManifest = z.infer<typeof candidateManifestSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunRound = z.infer<typeof roundManifestSchema>;
export type RunRecommendation = z.infer<typeof runRecommendationSchema>;
export type ExportPlan = z.infer<typeof exportPlanSchema>;
export type LatestRunState = z.infer<typeof latestRunStateSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type ExportMode = z.infer<typeof exportModeSchema>;
