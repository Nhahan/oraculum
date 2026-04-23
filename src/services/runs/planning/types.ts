import type { Adapter } from "../../../domain/config.js";

export interface PlanRunOptions {
  cwd: string;
  taskInput: string;
  agent?: Adapter;
  candidates?: number;
  clarificationAnswer?: string;
  deliberate?: boolean;
  planningLane?: "explicit-plan" | "consult-lite";
  requirePlanningClarification?: boolean;
  writeConsultationPlanArtifacts?: boolean;
  preflight?: {
    allowRuntime?: boolean;
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  };
  autoProfile?: {
    allowRuntime?: boolean;
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  };
}
