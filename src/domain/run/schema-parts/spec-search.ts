import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";
import { adapterSchema } from "../../config.js";
import { projectRelativePathSchema } from "../../project-path.js";

export const implementationVarianceRiskSchema = z.enum(["low", "medium", "high"]);

export const candidateSpecContentSchema = z.object({
  summary: z.string().min(1),
  approach: z.string().min(1),
  keyChanges: z.array(z.string().min(1)).min(1).max(8),
  expectedChangedPaths: z.array(projectRelativePathSchema).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  validationPlan: z.array(z.string().min(1)).default([]),
  riskNotes: z.array(z.string().min(1)).default([]),
});

export const candidateSpecArtifactSchema = candidateSpecContentSchema.extend({
  runId: artifactPathSegmentSchema,
  candidateId: artifactPathSegmentSchema,
  strategyId: z.string().min(1),
  strategyLabel: z.string().min(1),
  adapter: adapterSchema,
  createdAt: z.string().min(1),
});

export const candidateSpecSelectionReasonSchema = z.object({
  candidateId: artifactPathSegmentSchema,
  rank: z.number().int().min(1),
  selected: z.boolean().default(false),
  reason: z.string().min(1),
});

export const candidateSpecSelectionRecommendationSchema = z.object({
  rankedCandidateIds: z.array(artifactPathSegmentSchema).min(1),
  selectedCandidateIds: z.array(artifactPathSegmentSchema).default([]),
  implementationVarianceRisk: implementationVarianceRiskSchema.default("low"),
  validationGaps: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
  reasons: z.array(candidateSpecSelectionReasonSchema).default([]),
});

export const candidateSpecSelectionArtifactSchema =
  candidateSpecSelectionRecommendationSchema.extend({
    runId: artifactPathSegmentSchema,
    adapter: adapterSchema,
    createdAt: z.string().min(1),
    status: z.enum(["selected", "fallback-to-patch-tournament"]),
  });
