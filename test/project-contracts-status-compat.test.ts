import { describe, expect, it } from "vitest";

import { buildSavedConsultationStatus, savedConsultationStatusSchema } from "../src/domain/run.js";

describe("project contracts", () => {
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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

  it("derives canonical validation-gap presence from the manifest outcome", () => {
    const status = buildSavedConsultationStatus({
      id: "run_gap_status",
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

  it("accepts canonical validation gap presence", () => {
    const parsed = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "no-survivors",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchBasisStatus: "unknown",
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

    expect(parsed.validationGapsPresent).toBe(false);
  });

  it("rejects status payloads that omit validation gap presence", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
});
