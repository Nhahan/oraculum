import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import {
  buildVerdictReview,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import {
  createClarificationManifest,
  createInitializedProject,
  createManifest,
  createPromotedCandidate,
  createRecommendedManifest,
  registerConsultationsTempRootCleanup,
  writeClarifyFollowUp,
  writeExportPlanArtifact,
  writeManifest,
  writePreflightReadinessArtifact,
  writeProfileSelectionArtifact,
  writeSecondOpinionWinnerSelection,
  writeWinnerSelection,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation verdict review runtime", () => {
  it("builds a machine-readable verdict review from saved consultation state", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_1", {
      candidateStatus: "exported",
      outcomeOverrides: {
        validationPosture: "validation-gaps",
      },
      manifestOverrides: {
        profileSelection: {
          profileId: "frontend",
          confidence: "high",
          source: "llm-recommendation",
          summary: "Frontend evidence is strongest.",
          candidateCount: 4,
          strategyIds: ["minimal-change", "test-amplified"],
          oracleIds: ["build-impact"],
          missingCapabilities: ["No e2e or visual deep check was detected."],
          signals: ["frontend-framework", "build-script"],
        },
        preflight: {
          decision: "proceed",
          confidence: "high",
          summary: "Repository evidence is sufficient to execute immediately.",
          researchPosture: "repo-only",
        },
      },
    });
    await writeWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
      exitCode: 0,
      summary: "Judge selected cand-01.",
      recommendation: {
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      artifacts: [],
    });
    await writePreflightReadinessArtifact(cwd, manifest.id);
    const profileSelection = manifest.profileSelection;
    if (!profileSelection) {
      throw new Error("expected persisted profile selection");
    }
    await writeProfileSelectionArtifact(cwd, manifest.id, profileSelection);

    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
      comparisonMarkdownPath: "/tmp/run_1/reports/comparison.md",
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review).toEqual({
      outcomeType: "recommended-survivor",
      outcomeSummary: "Recommended survivor was selected.",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      judgingBasisSummary: "Judged with repo-local validation oracles.",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchBasisStatus: "unknown",
      researchSignalCount: 0,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [
        "Frontend evidence is strongest.",
        "Validation evidence: frontend-framework",
        "Validation evidence: build-script",
        "cand-01 is the recommended promotion.",
      ],
      weakestEvidence: ["No e2e or visual deep check was detected."],
      secondOpinionTriggerKinds: [],
      secondOpinionTriggerReasons: [],
      recommendationSummary: "cand-01 is the recommended promotion.",
      manualReviewRecommended: false,
      manualCrowningCandidateIds: [],
      validationProfileId: "frontend",
      validationSummary: "Frontend evidence is strongest.",
      validationSignals: ["frontend-framework", "build-script"],
      validationGaps: ["No e2e or visual deep check was detected."],
      preflightDecision: "proceed",
      researchPosture: "repo-only",
      researchRerunRecommended: false,
      artifactAvailability: {
        preflightReadiness: true,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: true,
        comparisonReport: false,
        winnerSelection: true,
        secondOpinionWinnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });
  });

  it("renders clarify follow-up artifacts and replay guidance for repeated blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_clarify_follow_up", {
      preflightOverrides: {
        summary: "The exact target artifact shape is still ambiguous.",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);
    await writeClarifyFollowUp(cwd, manifest.id, {
      runId: manifest.id,
      adapter: "codex",
      decision: "needs-clarification",
      scopeKeyType: "target-artifact",
      scopeKey: "docs/PRD.md",
      repeatedCaseCount: 3,
      repeatedKinds: ["clarify-needed", "external-research-required"],
      recurringReasons: [
        "Which sections must docs/PRD.md contain?",
        "What evidence is required before editing docs/PRD.md?",
      ],
      summary: "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
      keyQuestion:
        "What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
      missingResultContract:
        "A concrete section-level result contract for docs/PRD.md is still missing.",
      missingJudgingBasis:
        "The review basis does not yet say how to judge the completed PRD artifact.",
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      clarifyFollowUpPath: getClarifyFollowUpPath(cwd, manifest.id),
    });

    expect(summary).toContain("Clarify follow-up: target-artifact (docs/PRD.md, 3 prior cases)");
    expect(summary).toContain(
      "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
    );
    expect(summary).toContain(
      "Key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(summary).toContain(
      "Missing result contract: A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(summary).toContain(
      "Missing judging basis: The review basis does not yet say how to judge the completed PRD artifact.",
    );
    expect(summary).toContain(
      "- clarify follow-up: .oraculum/runs/run_clarify_follow_up/reports/clarify-follow-up.json",
    );
    expect(summary).toContain(
      "- inspect the persisted clarify follow-up: .oraculum/runs/run_clarify_follow_up/reports/clarify-follow-up.json.",
    );
    expect(summary).toContain(
      "- answer the key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(summary).toContain(
      "- rerun `orc consult` once the missing result contract and judging basis are explicit.",
    );
    expect(review.clarifyScopeKeyType).toBe("target-artifact");
    expect(review.clarifyScopeKey).toBe("docs/PRD.md");
    expect(review.clarifyRepeatedCaseCount).toBe(3);
    expect(review.clarifyFollowUpQuestion).toBe(
      "What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(review.clarifyMissingResultContract).toBe(
      "A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(review.clarifyMissingJudgingBasis).toBe(
      "The review basis does not yet say how to judge the completed PRD artifact.",
    );
    expect(review.artifactAvailability.clarifyFollowUp).toBe(true);
    expect(review.strongestEvidence).toContain(
      "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
    );
    expect(review.strongestEvidence).toContain(
      "Key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(review.weakestEvidence).toContain(
      "Missing result contract: A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(review.weakestEvidence).toContain(
      "Missing judging basis: The review basis does not yet say how to judge the completed PRD artifact.",
    );
  });

  it("allows legacy validation-gap reviews that only know the gap count", async () => {
    const manifest = createManifest("completed", {
      id: "run_gap_review",
      candidateCount: 0,
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

    const review = await buildVerdictReview(manifest, {});

    expect(review.outcomeType).toBe("completed-with-validation-gaps");
    expect(review.validationGaps).toEqual([]);
    expect(review.recommendationAbsenceReason).toBe(
      "Execution completed with unresolved validation gaps.",
    );
    expect(review.manualReviewRecommended).toBe(true);
  });

  it("allows legacy survivor reviews that only know the recommended survivor id", async () => {
    const manifest = createManifest("completed", {
      id: "run_legacy_survivor_review",
      candidateCount: 1,
      rounds: [],
      candidates: [],
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });

    const review = verdictReviewSchema.parse(await buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("recommended-survivor");
    expect(review.recommendedCandidateId).toBe("cand-01");
    expect(review.finalistIds).toEqual(["cand-01"]);
    expect(review.manualReviewRecommended).toBe(false);
  });

  it("allows legacy finalists-without-recommendation reviews without invented finalist ids", async () => {
    const manifest = createManifest("completed", {
      id: "run_legacy_finalists_review",
      candidateCount: 2,
      rounds: [],
      candidates: [],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });

    const review = verdictReviewSchema.parse(await buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("finalists-without-recommendation");
    expect(review.finalistIds).toEqual([]);
    expect(review.recommendationAbsenceReason).toBe(
      "Finalists survived, but no recommendation was recorded.",
    );
    expect(review.manualReviewRecommended).toBe(true);
  });

  it("reads judge abstention evidence into verdict review handoff fields", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_manual_crown_review",
      recommendedWinner: undefined,
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [createPromotedCandidate("cand-01")],
    });
    await writeManifest(cwd, manifest);
    await writeWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
      exitCode: 0,
      summary: "Judge abstained.",
      recommendation: {
        decision: "abstain",
        confidence: "low",
        summary: "The finalists are too weak to recommend a safe promotion.",
      },
      artifacts: [],
    });

    const review = await buildVerdictReview(manifest, {
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review.recommendationAbsenceReason).toBe(
      "The finalists are too weak to recommend a safe promotion.",
    );
    expect(review.weakestEvidence).toContain(
      "The finalists are too weak to recommend a safe promotion.",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.manualCrowningCandidateIds).toEqual(["cand-01"]);
    expect(review.manualCrowningReason).toBe(
      "Finalists survived without a recorded recommendation; manual crowning requires operator judgment.",
    );
  });

  it("replays artifact-aware judging criteria from winner selection into verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_document_review", {
      taskPacketOverrides: {
        title: "Review PRD",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      recommendedWinnerOverrides: {
        summary: "cand-01 best satisfies the PRD contract.",
      },
    });
    await writeManifest(cwd, manifest);
    await writeWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
      exitCode: 0,
      summary: "Judge selected cand-01.",
      recommendation: {
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is safest.",
        judgingCriteria: [
          "Covers the documented scope without contradicting repo constraints.",
          "Leaves the PRD internally consistent and reviewable.",
        ],
      },
      artifacts: [],
    });

    const review = await buildVerdictReview(manifest, {
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review.judgingCriteria).toEqual([
      "Covers the documented scope without contradicting repo constraints.",
      "Leaves the PRD internally consistent and reviewable.",
    ]);
  });

  it("surfaces second-opinion disagreement in verdict review and blocks direct crown guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_review");
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["many-changed-paths"],
      triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "completed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 0,
        summary: "Second opinion abstained.",
        recommendation: {
          decision: "abstain",
          confidence: "medium",
          summary: "Manual review is safer before crowning.",
        },
        artifacts: [],
      },
      agreement: "disagrees-select-vs-abstain",
      advisorySummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain(
      "- second-opinion winner selection: .oraculum/runs/run_second_opinion_review/reports/winner-selection.second-opinion.json",
    );
    expect(summary).toContain("Second-opinion judge: claude-code (disagrees-select-vs-abstain)");
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(review.secondOpinionAdapter).toBe("claude-code");
    expect(review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
    expect(review.secondOpinionDecision).toBe("abstain");
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.weakestEvidence).toContain(
      "Second-opinion judge abstained, while the primary path selected a finalist.",
    );
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(true);
  });

  it("marks archive recommendations as manual review when second-opinion disagreement exists", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_archive");
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["many-changed-paths"],
      triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "completed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 0,
        summary: "Second opinion abstained.",
        recommendation: {
          decision: "abstain",
          confidence: "medium",
          summary: "Manual review is safer before crowning.",
        },
        artifacts: [],
      },
      agreement: "disagrees-select-vs-abstain",
      advisorySummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
    });

    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(archive).toContain(
      "- run_second_opinion_archive | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("surfaces second-opinion unavailability in verdict review and blocks direct crown guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_unavailable_review");
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "failed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 1,
        summary: "Second opinion was unavailable.",
        artifacts: [],
      },
      agreement: "unavailable",
      advisorySummary: "Second-opinion judge was unavailable, so manual review is still required.",
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain(
      "- second-opinion winner selection: .oraculum/runs/run_second_opinion_unavailable_review/reports/winner-selection.second-opinion.json",
    );
    expect(summary).toContain("Second-opinion judge: claude-code (unavailable)");
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(review.secondOpinionAdapter).toBe("claude-code");
    expect(review.secondOpinionAgreement).toBe("unavailable");
    expect(review.secondOpinionDecision).toBeUndefined();
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.weakestEvidence).toContain(
      "Second-opinion judge was unavailable, so manual review is still required.",
    );
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(true);
  });

  it("marks archive recommendations as manual review when second-opinion is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_unavailable_archive");
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "failed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 1,
        summary: "Second opinion was unavailable.",
        artifacts: [],
      },
      agreement: "unavailable",
      advisorySummary: "Second-opinion judge was unavailable, so manual review is still required.",
    });

    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(archive).toContain(
      "- run_second_opinion_unavailable_archive | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("keeps manual-review guidance visible after crowning when second-opinion is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_unavailable_crowned", {
      candidateStatus: "exported",
    });
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "failed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 1,
        summary: "Second opinion was unavailable.",
        artifacts: [],
      },
      agreement: "unavailable",
      advisorySummary: "Second-opinion judge was unavailable, so manual review is still required.",
    });
    await writeExportPlanArtifact(cwd, manifest.id, "cand-01");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain("Second-opinion judge: claude-code (unavailable)");
    expect(summary).toContain(
      "- inspect the second-opinion judge before relying on the recommended result: .oraculum/runs/run_second_opinion_unavailable_crowned/reports/winner-selection.second-opinion.json.",
    );
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_second_opinion_unavailable_crowned/reports/export-plan.json",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.artifactAvailability.crowningRecord).toBe(true);
    expect(review.secondOpinionAgreement).toBe("unavailable");
    expect(archive).toContain(
      "- run_second_opinion_unavailable_crowned | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("keeps disagreeing second-opinion guidance visible after crowning", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_second_opinion_disagreement_crowned", {
      candidateStatus: "exported",
    });
    await writeManifest(cwd, manifest);
    await writeSecondOpinionWinnerSelection(cwd, manifest.id, {
      runId: manifest.id,
      advisoryOnly: true,
      adapter: "claude-code",
      triggerKinds: ["many-changed-paths"],
      triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
      primaryRecommendation: {
        source: "llm-judge",
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
      },
      result: {
        runId: manifest.id,
        adapter: "claude-code",
        status: "completed",
        startedAt: "2026-04-04T00:00:00.000Z",
        completedAt: "2026-04-04T00:00:01.000Z",
        exitCode: 0,
        summary: "Second opinion abstained.",
        recommendation: {
          decision: "abstain",
          confidence: "medium",
          summary: "Manual review is safer before crowning.",
        },
        artifacts: [],
      },
      agreement: "disagrees-select-vs-abstain",
      advisorySummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
    });
    await writeExportPlanArtifact(cwd, manifest.id, "cand-01");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain("Second-opinion judge: claude-code (disagrees-select-vs-abstain)");
    expect(summary).toContain(
      "- inspect the second-opinion judge before relying on the recommended result: .oraculum/runs/run_second_opinion_disagreement_crowned/reports/winner-selection.second-opinion.json.",
    );
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_second_opinion_disagreement_crowned/reports/export-plan.json",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.artifactAvailability.crowningRecord).toBe(true);
    expect(review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
    expect(archive).toContain(
      "- run_second_opinion_disagreement_crowned | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });
});
