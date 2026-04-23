import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { z } from "zod";

import { decisionConfidenceSchema } from "./profile.js";

export const taskSourceKindSchema = z.enum([
  "task-packet",
  "task-note",
  "research-brief",
  "consultation-plan",
]);
export const taskResearchConflictHandlingSchema = z.enum(["accepted", "manual-review-required"]);
export const taskResearchBasisStatusSchema = z.enum(["current", "stale", "unknown"]);
export const taskResearchSourceSchema = z.object({
  kind: z.enum(["repo-doc", "official-doc", "curated-doc", "other"]),
  title: z.string().min(1),
  locator: z.string().min(1),
});
export const taskResearchClaimSchema = z.object({
  statement: z.string().min(1),
  sourceLocators: z.array(z.string().min(1)).default([]),
});
export const taskResearchContextSchema = z
  .object({
    question: z.string().min(1),
    summary: z.string().min(1),
    confidence: decisionConfidenceSchema.optional(),
    signalSummary: z.array(z.string().min(1)).default([]),
    signalFingerprint: z.string().min(1).optional(),
    sources: z.array(taskResearchSourceSchema).default([]),
    claims: z.array(taskResearchClaimSchema).default([]),
    versionNotes: z.array(z.string().min(1)).default([]),
    unresolvedConflicts: z.array(z.string().min(1)).default([]),
    conflictHandling: taskResearchConflictHandlingSchema,
  })
  .superRefine((value, context) => {
    const expectedHandling = deriveResearchConflictHandling(value.unresolvedConflicts);
    if (value.conflictHandling !== expectedHandling) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conflictHandling"],
        message:
          "conflictHandling must match unresolvedConflicts: use manual-review-required when conflicts exist, otherwise accepted.",
      });
    }
  });

export const taskPacketSourceSchema = z
  .object({
    kind: taskSourceKindSchema,
    path: z.string().min(1),
    originKind: taskSourceKindSchema.optional(),
    originPath: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.originKind) !== Boolean(value.originPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "originKind and originPath must either both be present or both be omitted.",
      });
    }
  });

export const taskPacketSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  artifactKind: z.string().min(1).optional(),
  targetArtifactPath: z.string().min(1).optional(),
  researchContext: taskResearchContextSchema.optional(),
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

export const taskPacketSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    sourceKind: taskSourceKindSchema,
    sourcePath: z.string().min(1),
    artifactKind: z.string().min(1).optional(),
    targetArtifactPath: z.string().min(1).optional(),
    researchContext: taskResearchContextSchema.optional(),
    originKind: taskSourceKindSchema.optional(),
    originPath: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.originKind) !== Boolean(value.originPath)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "originKind and originPath must either both be present or both be omitted.",
      });
    }
  });

export type TaskPacket = z.infer<typeof taskPacketSchema>;
export type MaterializedTaskPacket = z.infer<typeof materializedTaskPacketSchema>;
export type TaskPacketSummary = z.infer<typeof taskPacketSummarySchema>;
export type TaskSourceKind = z.infer<typeof taskSourceKindSchema>;
export type TaskResearchContext = z.infer<typeof taskResearchContextSchema>;

export function deriveResearchConflictHandling(
  unresolvedConflicts: string[],
): z.infer<typeof taskResearchConflictHandlingSchema> {
  return unresolvedConflicts.length > 0 ? "manual-review-required" : "accepted";
}

export function deriveResearchBasisStatus(options: {
  researchContext?: TaskResearchContext | undefined;
  researchBasisDrift?: boolean | undefined;
}): z.infer<typeof taskResearchBasisStatusSchema> {
  if (!options.researchContext) {
    return "unknown";
  }

  return options.researchBasisDrift ? "stale" : "current";
}

interface TaskResultDescriptorInput {
  artifactKind?: string | undefined;
  targetArtifactPath?: string | undefined;
}

export function deriveResearchSignalFingerprint(signalSummary: string[]): string {
  return createHash("sha256")
    .update([...signalSummary].sort((left, right) => left.localeCompare(right)).join("\n"))
    .digest("hex");
}

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

export function describeTaskResultLabel(task: TaskResultDescriptorInput): string {
  if (task.artifactKind && task.targetArtifactPath) {
    return `${task.artifactKind} result for ${task.targetArtifactPath}`;
  }

  if (task.artifactKind) {
    return `${task.artifactKind} result`;
  }

  if (task.targetArtifactPath) {
    return `result for ${task.targetArtifactPath}`;
  }

  return "survivor";
}

export function describeRecommendedTaskResultLabel(task: TaskResultDescriptorInput): string {
  const label = describeTaskResultLabel(task);
  return label === "survivor" ? "recommended survivor" : `recommended ${label}`;
}
