import { describe, expect, it } from "vitest";

import {
  createCandidate,
  createCompletedManifest,
  createOrcActionTempRoot,
  getFinalistComparisonJsonPath,
  mockedBuildVerdictReview,
  mockedReadRunManifest,
  registerOrcActionsTestHarness,
  runVerdictAction,
  writeDisagreeingSecondOpinionSelection,
  writeExportPlanArtifact,
  writeTextArtifact,
  writeUnavailableSecondOpinionSelection,
} from "./helpers/orc-actions-verdict.js";

registerOrcActionsTestHarness();

describe("chat-native Orc actions: verdict manual review response", () => {
  it("returns aligned review, artifacts, and status when a crowned recommendation still requires manual review", async () => {
    const root = await createOrcActionTempRoot(
      "oraculum-orc-actions-crowned-manual-review-response-",
    );
    mockedReadRunManifest.mockResolvedValue({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
        }),
      ],
    });
    mockedBuildVerdictReview.mockResolvedValueOnce({
      outcomeType: "recommended-survivor",
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
      researchBasisStatus: "unknown",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [],
      weakestEvidence: [],
      secondOpinionAdapter: "claude-code",
      secondOpinionTriggerKinds: ["low-confidence"],
      secondOpinionTriggerReasons: ["Primary judge confidence was low."],
      secondOpinionAgreement: "unavailable",
      secondOpinionSummary: "Manual review is still required because the second opinion failed.",
      manualReviewRecommended: true,
      manualCrowningCandidateIds: [],
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        secondOpinionWinnerSelection: true,
        crowningRecord: true,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });

    await writeExportPlanArtifact(root, "run_1", "cand-01");
    await writeUnavailableSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Second opinion was unavailable.",
      advisorySummary:
        "Manual review is still required because the second opinion was unavailable.",
    });

    const verdict = await runVerdictAction({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.artifacts.crowningRecordPath).toBeDefined();
    expect(verdict.artifacts.secondOpinionWinnerSelectionPath).toBeDefined();
    expect(verdict.status.nextActions).toEqual(["reopen-verdict", "perform-manual-review"]);
    expect(verdict.review.manualReviewRecommended).toBe(true);
    expect(verdict.review.artifactAvailability.crowningRecord).toBe(true);
    expect(verdict.review.secondOpinionAgreement).toBe("unavailable");
  });

  it("returns aligned review, artifacts, and status when an uncrowned recommendation requires manual review", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-uncrowned-manual-review-");
    mockedReadRunManifest.mockResolvedValue({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
        }),
      ],
    });
    mockedBuildVerdictReview.mockResolvedValueOnce({
      outcomeType: "recommended-survivor",
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
      researchBasisStatus: "unknown",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [],
      weakestEvidence: [],
      secondOpinionAdapter: "claude-code",
      secondOpinionTriggerKinds: ["many-changed-paths"],
      secondOpinionTriggerReasons: [
        "A finalist changed 3 paths, meeting the second-opinion threshold (1).",
      ],
      secondOpinionAgreement: "disagrees-select-vs-abstain",
      secondOpinionDecision: "abstain",
      secondOpinionSummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
      manualReviewRecommended: true,
      manualCrowningCandidateIds: [],
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        secondOpinionWinnerSelection: true,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });

    await writeDisagreeingSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["many-changed-paths"],
      triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Manual review is safer before crowning.",
      resultRunnerSummary: "Second opinion abstained.",
      advisorySummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
    });

    const verdict = await runVerdictAction({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.artifacts.crowningRecordPath).toBeUndefined();
    expect(verdict.artifacts.secondOpinionWinnerSelectionPath).toBeDefined();
    expect(verdict.status.nextActions).toEqual(["reopen-verdict", "perform-manual-review"]);
    expect(verdict.review.manualReviewRecommended).toBe(true);
    expect(verdict.review.artifactAvailability.comparisonReport).toBe(false);
    expect(verdict.review.artifactAvailability.crowningRecord).toBe(false);
    expect(verdict.review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
  });

  it("does not reintroduce comparison inspection when a crowned recommendation still requires manual review", async () => {
    const root = await createOrcActionTempRoot(
      "oraculum-orc-actions-crowned-manual-review-comparison-",
    );
    mockedReadRunManifest.mockResolvedValue({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
        }),
      ],
    });

    await writeTextArtifact(
      getFinalistComparisonJsonPath(root, "run_1"),
      `${JSON.stringify(
        {
          runId: "run_1",
          finalists: [
            {
              candidateId: "cand-01",
              strategyLabel: "Minimal Change",
              winner: true,
              whyItAdvanced: "cand-01 passed the selected checks.",
              changedPaths: ["src/index.ts"],
              changedPathCount: 1,
            },
          ],
          whyThisWon: "cand-01 remains the strongest recommendation.",
        },
        null,
        2,
      )}\n`,
    );
    await writeExportPlanArtifact(root, "run_1", "cand-01");
    await writeUnavailableSecondOpinionSelection(root, "run_1", {
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryConfidence: "high",
      primarySummary: "cand-01 is the recommended promotion.",
      resultSummary: "Second opinion was unavailable.",
      advisorySummary:
        "Manual review is still required because the second opinion was unavailable.",
    });

    const verdict = await runVerdictAction({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual(["reopen-verdict", "perform-manual-review"]);
    expect(getFinalistComparisonJsonPath(root, "run_1")).toBeDefined();
  });
});
