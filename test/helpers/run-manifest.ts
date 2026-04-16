import type { RunManifest } from "../../src/domain/run.js";
import { createTaskPacketSummaryFixture } from "./contract-fixtures.js";

type CandidateStatus = RunManifest["candidates"][number]["status"];
type RoundStatus = RunManifest["rounds"][number]["status"];

export function createTaskPacketFixture(
  overrides: Partial<RunManifest["taskPacket"]> = {},
): RunManifest["taskPacket"] {
  return createTaskPacketSummaryFixture(overrides);
}

export function createRunCandidateFixture(
  candidateId: string,
  status: CandidateStatus,
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  const {
    strategyId,
    strategyLabel,
    workspaceDir,
    taskPacketPath,
    repairCount,
    repairedRounds,
    createdAt,
    ...restOverrides
  } = overrides;

  return {
    id: candidateId,
    strategyId: strategyId ?? "minimal-change",
    strategyLabel: strategyLabel ?? "Minimal Change",
    status,
    workspaceDir: workspaceDir ?? `/tmp/${candidateId}`,
    taskPacketPath: taskPacketPath ?? `/tmp/${candidateId}.task-packet.json`,
    repairCount: repairCount ?? 0,
    repairedRounds: repairedRounds ?? [],
    createdAt: createdAt ?? "2026-04-04T00:00:00.000Z",
    ...restOverrides,
  };
}

export function createRunRoundFixture(
  status: RoundStatus,
  overrides: Partial<RunManifest["rounds"][number]> = {},
): RunManifest["rounds"][number] {
  return {
    id: "fast",
    label: "Fast",
    status,
    verdictCount: status === "completed" ? 1 : 0,
    survivorCount: status === "completed" ? 1 : 0,
    eliminatedCount: 0,
    ...overrides,
  };
}

export function createRunManifestFixture(options: {
  runId?: string;
  status: "planned" | "completed";
  candidates?: RunManifest["candidates"];
  rounds?: RunManifest["rounds"];
  overrides?: Partial<RunManifest>;
}): RunManifest {
  const {
    runId = "run_1",
    status,
    candidates = [
      createRunCandidateFixture("cand-01", status === "completed" ? "exported" : "planned"),
    ],
    rounds = [createRunRoundFixture(status === "completed" ? "completed" : "pending")],
    overrides = {},
  } = options;

  return {
    id: runId,
    status,
    taskPath: "/tmp/task.md",
    taskPacket: createTaskPacketFixture(),
    agent: "codex",
    candidateCount: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds,
    candidates,
    ...overrides,
  };
}

export function createRecommendedSurvivorOutcomeFixture(
  overrides: Partial<NonNullable<RunManifest["outcome"]>> = {},
): NonNullable<RunManifest["outcome"]> {
  return {
    type: "recommended-survivor",
    terminal: true,
    crownable: true,
    finalistCount: 1,
    recommendedCandidateId: "cand-01",
    validationPosture: "sufficient",
    verificationLevel: "lightweight",
    validationGapCount: 0,
    judgingBasisKind: "unknown",
    ...overrides,
  };
}

export function createBlockedPreflightOutcomeFixture(
  overrides: Partial<NonNullable<RunManifest["outcome"]>> = {},
): NonNullable<RunManifest["outcome"]> {
  return {
    type: "needs-clarification",
    terminal: true,
    crownable: false,
    finalistCount: 0,
    validationPosture: "unknown",
    verificationLevel: "none",
    validationGapCount: 0,
    judgingBasisKind: "unknown",
    ...overrides,
  };
}
