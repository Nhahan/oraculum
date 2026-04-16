import { describe, expect, it } from "vitest";

import { verdictReviewSchema } from "../src/domain/chat-native.js";

describe("consultation verdict review contracts", () => {
  it("backfills and validates legacy verdict review aliases at the schema boundary", () => {
    const parsed = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "frontend",
      validationSignals: ["frontend-framework"],
      validationGaps: ["No build validation command was selected."],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.profileMissingCapabilities).toEqual([
      "No build validation command was selected.",
    ]);

    expect(() =>
      verdictReviewSchema.parse({
        ...parsed,
        profileId: "library",
      }),
    ).toThrow("profileId must match validationProfileId");
  });

  it("backfills researchConflictHandling from persisted verdict review research signals", () => {
    const conflicted = verdictReviewSchema.parse({
      outcomeType: "external-research-required",
      verificationLevel: "none",
      validationPosture: "validation-gaps",
      judgingBasisKind: "missing-capability",
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 0,
      researchSummary: "External documentation still contains conflicting guidance.",
      researchRerunRecommended: true,
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchVersionNoteCount: 0,
      researchConflictCount: 1,
      researchConflictsPresent: true,
      validationSignals: [],
      validationGaps: [],
      researchPosture: "external-research-required",
      manualReviewRecommended: true,
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: true,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    const current = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "sufficient",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 1,
      researchSignalFingerprint: "fingerprint",
      researchRerunRecommended: false,
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationSignals: [],
      validationGaps: [],
      researchPosture: "repo-plus-external-docs",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: true,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(conflicted.researchBasisStatus).toBe("current");
    expect(conflicted.researchConflictHandling).toBe("manual-review-required");
    expect(current.researchConflictHandling).toBe("accepted");
  });

  it("accepts reordered legacy verdict review gap aliases", () => {
    const parsed = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "frontend",
      validationSignals: ["frontend-framework"],
      validationGaps: [
        "No build validation command was selected.",
        "No e2e or visual deep check was detected.",
      ],
      profileMissingCapabilities: [
        "No e2e or visual deep check was detected.",
        "No build validation command was selected.",
      ],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(parsed.validationGaps).toEqual([
      "No build validation command was selected.",
      "No e2e or visual deep check was detected.",
    ]);
    expect(parsed.profileMissingCapabilities).toEqual([
      "No e2e or visual deep check was detected.",
      "No build validation command was selected.",
    ]);
  });

  it("rejects recommended-survivor review payloads that omit the recommended candidate id", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommendedCandidateId is required when outcomeType is recommended-survivor");
  });

  it("rejects review payloads whose finalist ids do not match survivor semantics", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommended-survivor reviews require at least one finalist id");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-02"],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommended-survivor reviews must include recommendedCandidateId in finalistIds");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "standard",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow(
      "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present",
    );
  });

  it("rejects manual crowning ids that do not match finalists-without-recommendation reviews", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        manualCrowningCandidateIds: ["cand-02"],
        manualReviewRecommended: true,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("manualCrowningCandidateIds must match finalistIds");
  });

  it("rejects manual crowning ids when manual review is not recommended", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        manualCrowningCandidateIds: ["cand-01"],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("manualReviewRecommended must be true");
  });

  it("rejects manual crowning reasons without exposed manual crowning candidates", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        manualReviewRecommended: true,
        manualCrowningReason: "Operator review is required before crowning.",
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("manualCrowningReason is only allowed");
  });

  it("rejects finalists-without-recommendation reviews that do not recommend manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("finalists-without-recommendation reviews must recommend manual review");
  });

  it("rejects validation-gap reviews that do not recommend manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "lightweight",
        validationPosture: "validation-gaps",
        judgingBasisKind: "missing-capability",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        manualReviewRecommended: false,
        validationGaps: ["No repo-local oracle was recorded."],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("completed-with-validation-gaps reviews must recommend manual review");
  });

  it("rejects recommended-survivor reviews that hide second-opinion disagreement without manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-01"],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        secondOpinionAdapter: "claude-code",
        secondOpinionAgreement: "disagrees-select-vs-abstain",
        secondOpinionSummary:
          "Second-opinion judge abstained, while the primary path selected a finalist.",
        secondOpinionDecision: "abstain",
        secondOpinionTriggerKinds: ["many-changed-paths"],
        secondOpinionTriggerReasons: ["A finalist changed 3 paths, meeting the threshold."],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: true,
          winnerSelection: true,
          secondOpinionWinnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("recommended-survivor reviews must recommend manual review");
  });

  it("rejects verdict reviews whose outcome summary disagrees with the outcome and task context", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        outcomeSummary: "No recommended document result for docs/SESSION_PLAN.md emerged.",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        judgingBasisSummary: "Judged with repo-local validation oracles.",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        taskArtifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-01"],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("outcomeSummary must match outcomeType and task artifact context");
  });

  it("rejects verdict reviews whose judging basis summary disagrees with the judging basis kind", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        outcomeSummary: "No survivors advanced after the oracle rounds.",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        judgingBasisSummary: "Judged with repo-local validation oracles.",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("judgingBasisSummary must match judgingBasisKind");
  });

  it("rejects non-recommended review payloads that still include a recommended candidate id", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcomeType is recommended-survivor");
  });

  it("rejects non-finalist review payloads that still include finalist ids", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews require finalistIds to be empty");
  });

  it("rejects review payloads whose validation-gap semantics disagree with the outcome type", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: ["No build validation command was selected."],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews require validationGaps to be empty");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "missing-capability",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow(
      "completed-with-validation-gaps reviews require validationPosture to be validation-gaps",
    );

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews cannot use validation-gaps validationPosture");
  });

  it("rejects blocked-preflight review payloads whose validationPosture disagrees with the blocked state", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: true,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "external-research-required",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("external-research-required reviews require validationPosture to be validation-gaps");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "needs-clarification",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("needs-clarification reviews require validationPosture to be unknown");
  });

  it("rejects review payloads whose preflightDecision disagrees with the blocked outcome type", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        researchPosture: "repo-only",
        preflightDecision: "needs-clarification",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("preflightDecision needs-clarification requires outcomeType needs-clarification");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        researchPosture: "external-research-required",
        preflightDecision: "proceed",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("preflightDecision proceed cannot use a blocked preflight outcomeType");
  });
});
