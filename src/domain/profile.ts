import { z } from "zod";

import { roundIdSchema } from "./config.js";

export const decisionConfidenceSchema = z.enum(["low", "medium", "high"]);
export const consultationProfileIdSchema = z.enum(["library", "frontend", "migration"]);
export const packageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun", "unknown"]);

export const profileCommandCandidateSchema = z.object({
  id: z.string().min(1),
  roundId: roundIdSchema,
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  invariant: z.string().min(1),
});

export const profileRepoSignalsSchema = z.object({
  packageManager: packageManagerSchema,
  scripts: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  files: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([]),
  commandCatalog: z.array(profileCommandCandidateSchema).default([]),
});

export const agentProfileRecommendationSchema = z.object({
  profileId: consultationProfileIdSchema,
  confidence: decisionConfidenceSchema,
  summary: z.string().min(1),
  candidateCount: z.number().int().min(1).max(8),
  strategyIds: z.array(z.string().min(1)).min(1).max(4),
  selectedCommandIds: z.array(z.string().min(1)).default([]),
  missingCapabilities: z.array(z.string().min(1)).default([]),
});

export const consultationProfileSelectionSchema = z.object({
  profileId: consultationProfileIdSchema,
  confidence: decisionConfidenceSchema,
  source: z.enum(["llm-recommendation", "fallback-detection"]),
  summary: z.string().min(1),
  candidateCount: z.number().int().min(1).max(16),
  strategyIds: z.array(z.string().min(1)).min(1),
  oracleIds: z.array(z.string().min(1)).default([]),
  missingCapabilities: z.array(z.string().min(1)).default([]),
  signals: z.array(z.string().min(1)).default([]),
});

export type DecisionConfidence = z.infer<typeof decisionConfidenceSchema>;
export type ConsultationProfileId = z.infer<typeof consultationProfileIdSchema>;
export type PackageManager = z.infer<typeof packageManagerSchema>;
export type ProfileCommandCandidate = z.infer<typeof profileCommandCandidateSchema>;
export type ProfileRepoSignals = z.infer<typeof profileRepoSignalsSchema>;
export type AgentProfileRecommendation = z.infer<typeof agentProfileRecommendationSchema>;
export type ConsultationProfileSelection = z.infer<typeof consultationProfileSelectionSchema>;
