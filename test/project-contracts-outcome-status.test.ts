import { describe, expect, it } from "vitest";

import { consultationOutcomeSchema, savedConsultationStatusSchema } from "../src/domain/run.js";

describe("project contracts", () => {
  it("accepts canonical outcome gap counts", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "pending-execution",
        terminal: false,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "unknown",
      }),
    ).not.toThrow();
  });

  it("requires explicit persisted research status fields", () => {
    const conflicted = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "external-research-required",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchBasisStatus: "current",
      researchConflictHandling: "manual-review-required",
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
      researchBasisStatus: "current",
      researchConflictHandling: "accepted",
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

  it("rejects outcome payloads that omit validation gap counts", () => {
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
        researchBasisStatus: "unknown",
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
});
