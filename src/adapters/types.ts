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

export const finalistSummarySchema = z.object({
  candidateId: z.string().min(1),
  strategyLabel: z.string().min(1),
  summary: z.string().min(1),
  artifactKinds: z.array(agentArtifactKindSchema).default([]),
  verdicts: z.array(
    z.object({
      roundId: z.string().min(1),
      oracleId: z.string().min(1),
      status: z.string().min(1),
      severity: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
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

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type FinalistSummary = z.infer<typeof finalistSummarySchema>;
export type AgentJudgeRecommendation = z.infer<typeof agentJudgeRecommendationSchema>;
export type AgentJudgeResult = z.infer<typeof agentJudgeResultSchema>;
