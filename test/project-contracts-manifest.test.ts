import { describe, expect, it } from "vitest";

import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";

describe("project contracts", () => {
  it("derives outcome gaps from validation-first profile selections in legacy manifest normalization", () => {
    const parsed = parseRunManifestArtifact({
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
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      profileSelection: {
        validationProfileId: "frontend",
        confidence: "medium",
        source: "llm-recommendation",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: [],
        validationSignals: ["frontend-config"],
        validationGaps: ["No build validation command was selected."],
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.validationPosture).toBe("validation-gaps");
  });

  it("backfills outcome gap aliases for legacy manifests that already persisted an outcome", () => {
    const parsed = parseRunManifestArtifact({
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
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      profileSelection: {
        validationProfileId: "frontend",
        confidence: "medium",
        source: "llm-recommendation",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: [],
        validationSignals: ["frontend-config"],
        validationGaps: ["No build validation command was selected."],
      },
      outcome: {
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        judgingBasisKind: "missing-capability",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.missingCapabilityCount).toBe(1);
    expect(parsed.outcome?.type).toBe("completed-with-validation-gaps");
  });

  it("backfills zero validation gaps for legacy blocked outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact({
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
      candidateCount: 0,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("needs-clarification");
  });

  it("backfills zero validation gaps for legacy external-research outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact({
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
      candidateCount: 0,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("external-research-required");
  });

  it("backfills the recommended candidate id for legacy survivor outcomes", () => {
    const parsed = parseRunManifestArtifact({
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
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      recommendedWinner: {
        candidateId: "cand-01",
        summary: "cand-01 is the recommended promotion.",
        confidence: "high",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });

    expect(parsed.outcome?.recommendedCandidateId).toBe("cand-01");
  });

  it("rejects manifests whose recommended winner disagrees with the outcome survivor id", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        recommendedWinner: {
          candidateId: "cand-02",
          summary: "cand-02 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommendedWinner.candidateId must match outcome.recommendedCandidateId when both are present.",
    );
  });

  it("rejects planned manifests that persist a terminal outcome", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "planned",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow("planned manifests must use the pending-execution outcome type");
  });

  it("rejects completed manifests that still persist nonterminal outcome types", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "running",
          terminal: false,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("completed manifests cannot use pending-execution or running outcome types");
  });

  it("rejects manifests whose candidateCount does not match the persisted candidates", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "candidateCount must match the number of persisted candidates when candidate records are present",
    );
  });

  it("rejects manifests whose finalistCount does not match promoted or exported candidates", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 0,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "outcome.finalistCount must match the number of promoted or exported candidates when candidate records are present",
    );
  });

  it("rejects manifests that persist a recommended winner for non-survivor outcomes", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        recommendedWinner: {
          candidateId: "cand-01",
          summary: "cand-01 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "no-survivors",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("recommendedWinner is only allowed when outcome type is recommended-survivor");
  });

  it("rejects manifests whose recommended survivor is not promoted or exported", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "planned",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommended survivors must reference a promoted or exported candidate when that candidate is present in the manifest",
    );
  });

  it("rejects manifests whose recommended survivor does not exist in persisted candidate records", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-02",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommended survivors must reference a persisted candidate when candidate records are present in the manifest",
    );
  });

  it("rejects conflicting persisted outcome gap aliases during manifest normalization", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "completed-with-validation-gaps",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          judgingBasisKind: "missing-capability",
          validationGapCount: 1,
          missingCapabilityCount: 2,
        },
      }),
    ).toThrow("validationGapCount must match missingCapabilityCount");
  });

  it("rejects manifests whose outcome gap count disagrees with persisted profile selection gaps", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        profileSelection: {
          validationProfileId: "frontend",
          confidence: "medium",
          source: "llm-recommendation",
          validationSummary: "Frontend evidence is strongest.",
          candidateCount: 1,
          strategyIds: ["minimal-change"],
          oracleIds: [],
          validationSignals: ["frontend-config"],
          validationGaps: ["No build validation command was selected."],
        },
        outcome: {
          type: "completed-with-validation-gaps",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "missing-capability",
        },
      }),
    ).toThrow(
      "outcome.validationGapCount must match profileSelection validation gaps when a persisted profile selection is present",
    );
  });

  it("rejects manifests whose blocked preflight decision disagrees with the persisted outcome type", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The target file is unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which file should Oraculum update?",
        },
        outcome: {
          type: "no-survivors",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow(
      "blocked preflight decision needs-clarification requires outcome type needs-clarification",
    );

    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "proceed",
          confidence: "high",
          summary: "Repository evidence is sufficient to continue.",
          researchPosture: "repo-only",
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("preflight decision proceed cannot persist a blocked preflight outcome type");
  });

  it("rejects blocked preflight manifests that still persist candidates or recommendations", () => {
    expect(() =>
      parseRunManifestArtifact({
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
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The target file is unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which file should Oraculum update?",
        },
        outcome: {
          type: "needs-clarification",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist candidateCount above 0");

    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "planned",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        preflight: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official docs are required before execution.",
          researchPosture: "external-research-required",
          researchQuestion:
            "What does the official API documentation say about the current behavior?",
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist candidate records");

    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "abstain",
          confidence: "medium",
          summary: "The repository setup is not executable yet.",
          researchPosture: "repo-only",
        },
        recommendedWinner: {
          candidateId: "cand-01",
          summary: "cand-01 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "abstained-before-execution",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests cannot persist a recommended winner");

    expect(() =>
      parseRunManifestArtifact({
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
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [
          {
            id: "fast",
            label: "Fast",
            status: "completed",
            verdictCount: 0,
            survivorCount: 0,
            eliminatedCount: 0,
          },
        ],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The target file is unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which file should Oraculum update?",
        },
        outcome: {
          type: "needs-clarification",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist execution rounds");
  });
});
