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
}

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
