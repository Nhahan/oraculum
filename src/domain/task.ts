import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { z } from "zod";

export const taskSourceKindSchema = z.enum(["task-packet", "task-note", "research-brief"]);

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
export type TaskSourceKind = z.infer<typeof taskSourceKindSchema>;

export function deriveTaskPacketId(taskPath: string): string {
  const rawStem = basename(taskPath, extname(taskPath));
  const stem = rawStem
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  if (stem) {
    return stem;
  }

  const unicodeStem = rawStem
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  const stableSuffix = createHash("sha256").update(rawStem).digest("hex").slice(0, 8);
  return `${unicodeStem || "task"}-${stableSuffix}`;
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
