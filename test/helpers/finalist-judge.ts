import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AgentAdapter } from "../../src/adapters/types.js";
import {
  createConsultationPlanArtifactFixture,
  createProjectTaskPacketFixture,
} from "./contract-fixtures.js";
import { createTempRootHarness } from "./fs.js";
import { createRunCandidateFixture } from "./run-manifest.js";

const tempRootHarness = createTempRootHarness("oraculum-finalist-judge-");

export function registerFinalistJudgeTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function ensureReportsDir(projectRoot: string, runId: string): Promise<string> {
  const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
  await mkdir(reportsDir, { recursive: true });
  return reportsDir;
}

export async function recommendUnusedClarifyFollowUp(): Promise<never> {
  throw new Error("not used");
}

export function createJudgeOnlyAdapter(
  name: "codex" | "claude-code",
  recommendWinner: AgentAdapter["recommendWinner"],
): AgentAdapter {
  return {
    name,
    runCandidate: async () => {
      throw new Error("not used");
    },
    recommendPreflight: async () => {
      throw new Error("not used");
    },
    recommendProfile: async () => {
      throw new Error("not used");
    },
    recommendClarifyFollowUp: recommendUnusedClarifyFollowUp,
    recommendWinner,
  };
}

export function createCandidateResult(
  runId: string,
  candidateId: string,
  adapter: "codex" | "claude-code" = "codex",
) {
  return {
    runId,
    candidateId,
    adapter,
    status: "completed" as const,
    startedAt: "2026-04-05T00:00:00.000Z",
    completedAt: "2026-04-05T00:00:01.000Z",
    exitCode: 0,
    summary: "ok",
    artifacts: [],
  };
}

export function createFinalistCandidate(
  projectRoot: string,
  candidateId: string,
  overrides: Partial<{
    strategyId: string;
    strategyLabel: string;
    status: "promoted" | "exported";
    workspaceDir: string;
    taskPacketPath: string;
  }> = {},
) {
  const candidateOverrides = {
    ...(overrides.strategyId ? { strategyId: overrides.strategyId } : {}),
    ...(overrides.strategyLabel ? { strategyLabel: overrides.strategyLabel } : {}),
    workspaceDir: overrides.workspaceDir ?? join(projectRoot, "workspace"),
    taskPacketPath: overrides.taskPacketPath ?? join(projectRoot, "task-packet.json"),
    createdAt: "2026-04-05T00:00:00.000Z",
  };

  return createRunCandidateFixture(candidateId, overrides.status ?? "promoted", {
    ...candidateOverrides,
  });
}

export function createTaskPacket(
  projectRoot: string,
  overrides: Partial<{
    title: string;
    intent: string;
    artifactKind: "document";
    targetArtifactPath: string;
    sourceKind: "task-note" | "consultation-plan";
    sourcePath: string;
    nonGoals: string[];
    acceptanceCriteria: string[];
    risks: string[];
    oracleHints: string[];
    strategyHints: string[];
    contextFiles: string[];
  }> = {},
) {
  return createProjectTaskPacketFixture(projectRoot, {
    ...(overrides.title ? { title: overrides.title } : {}),
    ...(overrides.intent ? { intent: overrides.intent } : {}),
    ...(overrides.artifactKind ? { artifactKind: overrides.artifactKind } : {}),
    ...(overrides.targetArtifactPath ? { targetArtifactPath: overrides.targetArtifactPath } : {}),
    nonGoals: overrides.nonGoals ?? [],
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    risks: overrides.risks ?? [],
    oracleHints: overrides.oracleHints ?? [],
    strategyHints: overrides.strategyHints ?? [],
    contextFiles: overrides.contextFiles ?? [],
    source: {
      kind: overrides.sourceKind ?? "task-note",
      path: overrides.sourcePath ?? join(projectRoot, "task.md"),
    },
  });
}

export function createConsultationPlan(projectRoot: string, runId: string, reportsDir: string) {
  return createConsultationPlanArtifactFixture(projectRoot, runId, reportsDir);
}
