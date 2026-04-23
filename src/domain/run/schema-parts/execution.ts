import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";
import { roundIdSchema } from "../../config.js";
import { decisionConfidenceSchema } from "../../profile.js";
import {
  candidateStatusSchema,
  roundExecutionStatusSchema,
  workspaceModeSchema,
} from "./shared.js";

export const candidateManifestSchema = z.object({
  id: artifactPathSegmentSchema,
  strategyId: z.string().min(1),
  strategyLabel: z.string().min(1),
  status: candidateStatusSchema,
  workspaceDir: z.string().min(1),
  taskPacketPath: z.string().min(1),
  specPath: z.string().min(1).optional(),
  specSelected: z.boolean().optional(),
  specSelectionReason: z.string().min(1).optional(),
  lastRunResultPath: z.string().min(1).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  baseRevision: z.string().min(1).optional(),
  baseSnapshotPath: z.string().min(1).optional(),
  repairCount: z.number().int().min(0).default(0),
  repairedRounds: z.array(roundIdSchema).default([]),
  createdAt: z.string().min(1),
});

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
  candidateId: artifactPathSegmentSchema,
  summary: z.string().min(1),
  confidence: decisionConfidenceSchema,
  source: z.enum(["llm-judge", "fallback-policy"]),
});
