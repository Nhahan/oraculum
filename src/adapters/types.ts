import { z } from "zod";

import { type Adapter, adapterSchema } from "../domain/config.js";
import type { MaterializedTaskPacket } from "../domain/task.js";

export const agentArtifactKindSchema = z.enum([
  "log",
  "patch",
  "prompt",
  "report",
  "stderr",
  "stdout",
  "transcript",
]);
export const agentRunStatusSchema = z.enum(["completed", "failed", "timed-out", "cancelled"]);

export const agentArtifactSchema = z.object({
  kind: agentArtifactKindSchema,
  path: z.string().min(1),
});

export const agentRunResultSchema = z.object({
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const judgeConfidenceSchema = z.enum(["low", "medium", "high"]);
export const finalistVerdictSchema = z.object({
  roundId: z.string().min(1),
  oracleId: z.string().min(1),
  status: z.string().min(1),
  severity: z.string().min(1),
  summary: z.string().min(1),
});
export const finalistChangeSummarySchema = z.object({
  mode: z.enum(["git-diff", "snapshot-diff", "none"]),
  changedPathCount: z.number().int().min(0),
  createdPathCount: z.number().int().min(0),
  removedPathCount: z.number().int().min(0),
  modifiedPathCount: z.number().int().min(0),
  addedLineCount: z.number().int().min(0).optional(),
  deletedLineCount: z.number().int().min(0).optional(),
});
export const finalistWitnessHighlightSchema = z.object({
  roundId: z.string().min(1),
  oracleId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
});
export const finalistWitnessRollupSchema = z.object({
  witnessCount: z.number().int().min(0),
  warningOrHigherCount: z.number().int().min(0),
  repairableCount: z.number().int().min(0),
  repairHints: z.array(z.string().min(1)).default([]),
  riskSummaries: z.array(z.string().min(1)).default([]),
  keyWitnesses: z.array(finalistWitnessHighlightSchema).default([]),
});
export const finalistRepairSummarySchema = z.object({
  attemptCount: z.number().int().min(0),
  repairedRounds: z.array(z.string().min(1)).default([]),
});

export const finalistSummarySchema = z.object({
  candidateId: z.string().min(1),
  strategyLabel: z.string().min(1),
  summary: z.string().min(1),
  artifactKinds: z.array(agentArtifactKindSchema).default([]),
  verdicts: z.array(finalistVerdictSchema),
  changedPaths: z.array(z.string().min(1)).default([]),
  changeSummary: finalistChangeSummarySchema,
  witnessRollup: finalistWitnessRollupSchema,
  repairSummary: finalistRepairSummarySchema,
});

export const agentJudgeRecommendationSchema = z.object({
  candidateId: z.string().min(1),
  confidence: judgeConfidenceSchema,
  summary: z.string().min(1),
});

export const agentJudgeResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: agentJudgeRecommendationSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export interface AgentRunRequest {
  runId: string;
  candidateId: string;
  strategyId: string;
  strategyLabel: string;
  workspaceDir: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  repairContext?: AgentRepairContext;
}

export interface AgentAdapter {
  readonly name: Adapter;

  runCandidate(request: AgentRunRequest): Promise<AgentRunResult>;
  recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult>;
}

export interface AgentJudgeRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  finalists: FinalistSummary[];
}

export interface AgentRepairContext {
  roundId: string;
  attempt: number;
  verdicts: Array<{
    oracleId: string;
    status: string;
    severity: string;
    summary: string;
    repairHint?: string;
  }>;
  keyWitnesses: Array<{
    title: string;
    detail: string;
    kind: string;
  }>;
}

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type FinalistSummary = z.infer<typeof finalistSummarySchema>;
export type AgentJudgeRecommendation = z.infer<typeof agentJudgeRecommendationSchema>;
export type AgentJudgeResult = z.infer<typeof agentJudgeResultSchema>;
