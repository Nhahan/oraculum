import { basename, extname } from "node:path";

import { z } from "zod";

export const taskSourceKindSchema = z.enum(["task-packet", "task-note"]);

export const taskPacketSourceSchema = z.object({
  kind: taskSourceKindSchema,
  path: z.string().min(1),
});

export const taskPacketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  nonGoals: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  oracleHints: z.array(z.string().min(1)).default([]),
  strategyHints: z.array(z.string().min(1)).default([]),
  contextFiles: z.array(z.string().min(1)).default([]),
});

export const materializedTaskPacketSchema = taskPacketSchema.extend({
  source: taskPacketSourceSchema,
});

export const taskPacketSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceKind: taskSourceKindSchema,
  sourcePath: z.string().min(1),
});

export type TaskPacket = z.infer<typeof taskPacketSchema>;
export type MaterializedTaskPacket = z.infer<typeof materializedTaskPacketSchema>;
export type TaskPacketSummary = z.infer<typeof taskPacketSummarySchema>;

export function deriveTaskPacketId(taskPath: string): string {
  const stem = basename(taskPath, extname(taskPath))
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return stem || "task";
}

export function extractTaskTitle(taskPath: string, content: string): string {
  const firstHeading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  if (firstHeading) {
    return firstHeading.slice(2).trim();
  }

  const stem = basename(taskPath, extname(taskPath)).replaceAll(/[-_]+/g, " ").trim();
  return stem || "Untitled task";
}
