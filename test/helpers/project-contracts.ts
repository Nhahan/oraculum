import type { RunManifest } from "../../src/domain/run.js";
import { createRunCandidateFixture, createTaskPacketFixture } from "./run-manifest.js";

export function createRunManifestArtifact(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "run_1",
    status: "completed",
    taskPath: "/tmp/task.md",
    taskPacket: createTaskPacketFixture({
      id: "task",
      title: "Task",
      sourceKind: "task-note",
      sourcePath: "/tmp/task.md",
    }),
    agent: "codex",
    candidateCount: 0,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [],
    candidates: [],
    ...overrides,
  };
}

export function createRunCandidateArtifact(
  status: RunManifest["candidates"][number]["status"],
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return createRunCandidateFixture("cand-01", status, overrides);
}
