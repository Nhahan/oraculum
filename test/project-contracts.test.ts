import { describe, expect, it } from "vitest";

import {
  buildSavedConsultationStatus,
  consultationOutcomeSchema,
  savedConsultationStatusSchema,
} from "../src/domain/run.js";
import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";

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

  it("rejects conflicting legacy and validation outcome gap aliases", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "pending-execution",
        terminal: false,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 1,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("validationGapCount must match missingCapabilityCount");
  });

  it("backfills legacy outcome gap aliases from validation-first payloads", () => {
    const parsed = consultationOutcomeSchema.parse({
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount: 0,
      validationPosture: "unknown",
      verificationLevel: "none",
      validationGapCount: 2,
      judgingBasisKind: "unknown",
    });

    expect(parsed.missingCapabilityCount).toBe(2);
  });

  it("normalizes legacy crown-recommended-survivor next actions to crown-recommended-result", () => {
    const parsed = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "sufficient",
      finalistCount: 1,
      validationGapsPresent: false,
      judgingBasisKind: "repo-local-oracle",
      verificationLevel: "lightweight",
      researchPosture: "repo-only",
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-survivor"],
      recommendedCandidateId: "cand-01",
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    expect(parsed.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "crown-recommended-result",
    ]);
  });

  it("backfills researchConflictHandling from persisted research status signals", () => {
    const conflicted = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "external-research-required",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: true,
      researchConflictsPresent: true,
      validationPosture: "validation-gaps",
      finalistCount: 0,
      validationGapsPresent: false,
      judgingBasisKind: "missing-capability",
      verificationLevel: "none",
      researchPosture: "external-research-required",
      nextActions: ["gather-external-research-and-rerun"],
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    const current = savedConsultationStatusSchema.parse({
      consultationId: "run_2",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 1,
      researchSignalFingerprint: "fingerprint",
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "sufficient",
      finalistCount: 1,
      validationGapsPresent: false,
      judgingBasisKind: "repo-local-oracle",
      verificationLevel: "lightweight",
      researchPosture: "repo-plus-external-docs",
      nextActions: ["reopen-verdict", "crown-recommended-result"],
      recommendedCandidateId: "cand-01",
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    expect(conflicted.researchConflictHandling).toBe("manual-review-required");
    expect(conflicted.researchBasisStatus).toBe("current");
    expect(current.researchConflictHandling).toBe("accepted");
  });

  it("rejects outcome payloads that omit both legacy and validation gap counts", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "pending-execution",
        terminal: false,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      }),
    ).toThrow();
  });

  it("rejects recommended-survivor outcomes that omit the recommended candidate id", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow("recommendedCandidateId is required when outcome type is recommended-survivor");
  });

  it("rejects non-recommended outcomes that still include a recommended candidate id", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        recommendedCandidateId: "cand-01",
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcome type is recommended-survivor");
  });

  it("rejects outcome and status payloads whose terminal or crownable flags contradict the outcome type", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: false,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow("terminal must be true when outcome type is recommended-survivor");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "needs-clarification",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("crownable must be false when outcomeType is needs-clarification");
  });

  it("rejects survivor-style outcomes that omit finalists", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 0,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow(
      "recommended-survivor and finalists-without-recommendation outcomes require finalistCount to be at least 1",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "recommended-survivor and finalists-without-recommendation statuses require finalistCount to be at least 1",
    );
  });

  it("rejects non-finalist outcome and status payloads that still report finalists", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 1,
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("no-survivors outcomes require finalistCount to be 0");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "needs-clarification",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("needs-clarification statuses require finalistCount to be 0");
  });

  it("rejects gap-type outcome and status payloads whose validation-gap semantics disagree", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "missing-capability",
      }),
    ).toThrow(
      "completed-with-validation-gaps outcomes require validationGapCount to be at least 1",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "missing-capability",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("completed-with-validation-gaps statuses require validationGapsPresent to be true");

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "missing-capability",
      }),
    ).toThrow(
      "completed-with-validation-gaps outcomes require validationPosture to be validation-gaps",
    );

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("no-survivors outcomes cannot use validation-gaps validationPosture");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: true,
        judgingBasisKind: "missing-capability",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "completed-with-validation-gaps statuses require validationPosture to be validation-gaps",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("no-survivors statuses cannot use validation-gaps validationPosture");
  });

  it("rejects blocked-preflight outcome and status payloads whose validationPosture disagrees with the blocked state", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow(
      "external-research-required outcomes require validationPosture to be validation-gaps",
    );

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("needs-clarification outcomes require validationPosture to be unknown");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "external-research-required",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: true,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "external-research-required",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "external-research-required statuses require validationPosture to be validation-gaps",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "abstained-before-execution",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("abstained-before-execution statuses require validationPosture to be unknown");
  });

  it("rejects status payloads whose preflightDecision disagrees with the blocked outcome type", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        preflightDecision: "needs-clarification",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("preflightDecision needs-clarification requires outcomeType needs-clarification");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "external-research-required",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        preflightDecision: "proceed",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("preflightDecision proceed cannot use a blocked preflight outcomeType");
  });

  it("rejects status payloads whose consultationState disagrees with outcomeType", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "planned",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        recommendedCandidateId: "cand-01",
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("planned consultation statuses must use outcomeType pending-execution");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "running",
        terminal: false,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "completed consultation statuses cannot use outcomeType pending-execution or running",
    );
  });

  it("rejects status payloads whose validation-gaps flag disagrees with the gap list", () => {
    expect(
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        recommendedCandidateId: "cand-01",
        finalistCount: 1,
        validationGapsPresent: true,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toMatchObject({
      outcomeType: "recommended-survivor",
      validationGapsPresent: true,
      validationGaps: [],
    });

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: ["No build validation command was selected."],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("validationGapsPresent must be true when detailed validationGaps are present");
  });

  it("allows legacy validation-gap statuses that only know the gap count", () => {
    const status = buildSavedConsultationStatus({
      id: "run_legacy_gap_status",
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
      updatedAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "missing-capability",
      },
    });

    expect(status.outcomeType).toBe("completed-with-validation-gaps");
    expect(status.validationGapsPresent).toBe(true);
    expect(status.validationGaps).toEqual([]);
  });

  it("rejects conflicting legacy and validation status gap-presence aliases", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        missingCapabilitiesPresent: false,
        validationGapsPresent: true,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("validationGapsPresent must match missingCapabilitiesPresent");
  });

  it("backfills legacy status gap-presence aliases from validation-first payloads", () => {
    const parsed = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "no-survivors",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "unknown",
      validationSignals: [],
      validationGaps: [],
      finalistCount: 0,
      validationGapsPresent: false,
      judgingBasisKind: "unknown",
      verificationLevel: "none",
      researchPosture: "unknown",
      nextActions: [],
      updatedAt: "2026-04-04T00:00:00.000Z",
    });

    expect(parsed.missingCapabilitiesPresent).toBe(false);
  });

  it("rejects status payloads that omit both legacy and validation gap-presence aliases", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects recommended-survivor status payloads that omit the recommended candidate id", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("recommendedCandidateId is required when outcomeType is recommended-survivor");
  });

  it("rejects non-recommended status payloads that still include a recommended candidate id", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        recommendedCandidateId: "cand-01",
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcomeType is recommended-survivor");
  });

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
