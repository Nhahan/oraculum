import { describe, expect, it } from "vitest";

import { buildSavedConsultationStatus } from "../src/domain/run.js";

describe("project contracts", () => {
  it("omits inspect-comparison-report when saved status is built with unavailable comparison artifacts", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 2,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "promoted",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
          {
            id: "cand-02",
            strategyId: "safety-first",
            strategyLabel: "Safety First",
            status: "promoted",
            workspaceDir: "/tmp/cand-02",
            taskPacketPath: "/tmp/cand-02/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
          finalistCount: 2,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      },
      {
        comparisonReportAvailable: false,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("omits direct crown when saved status is built with required manual review", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "promoted",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        manualReviewRequired: true,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });

  it("omits direct crown when a crowning record already exists", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        crowningRecordAvailable: true,
      },
    );

    expect(status.nextActions).toEqual(["reopen-verdict", "browse-archive"]);
  });

  it("keeps manual review explicit when a crowning record already exists", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        crowningRecordAvailable: true,
        manualReviewRequired: true,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
});
