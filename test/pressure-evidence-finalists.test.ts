import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getPressureEvidencePath,
  getRunManifestPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import {
  collectPressureEvidence,
  pressureEvidenceReportSchema,
  renderPressureEvidenceSummary,
  writePressureEvidenceReport,
} from "../src/services/pressure-evidence.js";
import {
  createCandidate,
  createFinalistsPressureManifest,
  createInitializedProject,
  createRecommendedPressureManifest,
  registerPressureEvidenceTempRootCleanup,
  writeAbstainingWinnerSelection,
  writeComparisonArtifacts,
  writeDisagreeingSecondOpinionSelection,
  writeFailureAnalysis,
  writeManifest,
  writeSelectedWinnerSelection,
  writeUnavailableSecondOpinionSelection,
} from "./helpers/pressure-evidence.js";

registerPressureEvidenceTempRootCleanup();

describe("pressure evidence collection: finalist pressure", () => {
  it("collects finalist-selection pressure and writes a replayable report artifact", async () => {
    const cwd = await createInitializedProject();

    const abstainManifest = createFinalistsPressureManifest("run_selection_abstain", {
      taskPacketOverrides: {
        title: "Compare release plan finalists",
        sourcePath: "/tmp/release-plan.md",
      },
      candidates: [createCandidate("cand-01", "promoted"), createCandidate("cand-02", "promoted")],
    });
    await writeManifest(cwd, abstainManifest);
    await writeAbstainingWinnerSelection(cwd, "run_selection_abstain", {
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:02.000Z",
      summary: "Judge abstained after comparing the finalists.",
      recommendation: {
        decision: "abstain",
        confidence: "medium",
        summary: "The finalists have conflicting strengths and need operator review.",
        judgingCriteria: ["Preserve release-plan structure", "Avoid unverified requirements"],
      },
    });
    await writeFailureAnalysis(cwd, "run_selection_abstain", {
      runId: "run_selection_abstain",
      generatedAt: "2026-04-04T00:00:03.000Z",
      trigger: "judge-abstained",
      summary:
        "The finalist judge abstained, so operator investigation is required before any rerun or crowning decision.",
      recommendedAction: "investigate-root-cause-before-rerun",
      validationGaps: [],
      candidates: [],
    });
    await writeComparisonArtifacts(cwd, "run_selection_abstain");

    const lowConfidenceManifest = createRecommendedPressureManifest("run_low_confidence", {
      createdAt: "2026-04-05T00:00:00.000Z",
      candidateId: "cand-low",
      candidateStatus: "exported",
      taskPacketOverrides: {
        title: "Finalize release plan",
        sourcePath: "/tmp/release-plan-v2.md",
      },
      recommendedWinnerOverrides: {
        confidence: "low",
        summary: "cand-low is the least risky option, but the evidence is still weak.",
      },
    });
    await writeManifest(cwd, lowConfidenceManifest);
    await writeSelectedWinnerSelection(cwd, "run_low_confidence", {
      candidateId: "cand-low",
      confidence: "low",
      resultSummary: "Judge selected a low-confidence winner.",
      recommendationSummary: "cand-low wins narrowly under the current judging criteria.",
      judgingCriteria: ["Preserve release-plan structure", "Avoid unverified requirements"],
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:02.000Z",
    });
    await writeDisagreeingSecondOpinionSelection(cwd, "run_low_confidence", {
      primaryCandidateId: "cand-low",
      primaryConfidence: "low",
      primarySummary: "cand-low wins narrowly under the current judging criteria.",
      startedAt: "2026-04-05T00:00:03.000Z",
      completedAt: "2026-04-05T00:00:04.000Z",
    });
    await writeComparisonArtifacts(cwd, "run_low_confidence");

    const { path, report } = await writePressureEvidenceReport(cwd);
    const saved = pressureEvidenceReportSchema.parse(
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
    const summary = renderPressureEvidenceSummary(report, { artifactPath: path });

    expect(path).toBe(getPressureEvidencePath(cwd));
    expect(saved.artifactCoverage).toEqual(
      expect.objectContaining({
        consultationsWithPreflightReadiness: 0,
        consultationsWithPreflightFallback: 0,
        consultationsWithClarifyFollowUp: 0,
        consultationsWithComparisonReport: 2,
        consultationsWithWinnerSelection: 2,
        consultationsWithFailureAnalysis: 1,
        consultationsWithManualReviewRecommendation: 2,
      }),
    );
    expect(saved.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 5,
        casesWithTargetArtifact: 5,
        casesWithComparisonReport: 5,
        casesWithWinnerSelection: 5,
        casesWithFailureAnalysis: 3,
        casesWithManualReviewRecommendation: 5,
      }),
    );
    expect(saved.finalistSelectionPressure.metadataCoverage).toEqual(
      expect.objectContaining({
        consultationCount: 2,
        consultationsWithValidationGaps: 0,
        consultationsWithCurrentResearchBasis: 0,
        consultationsWithStaleResearchBasis: 0,
        consultationsWithUnknownResearchBasis: 2,
        consultationsWithResearchConflicts: 0,
        consultationsWithResearchRerunRecommended: 0,
        consultationsWithJudgingCriteria: 2,
      }),
    );
    expect(saved.finalistSelectionPressure.totalCases).toBe(5);
    expect(saved.finalistSelectionPressure.finalistsWithoutRecommendationCases).toBe(1);
    expect(saved.finalistSelectionPressure.judgeAbstainCases).toBe(1);
    expect(saved.finalistSelectionPressure.manualCrowningCases).toBe(1);
    expect(saved.finalistSelectionPressure.lowConfidenceRecommendationCases).toBe(1);
    expect(saved.finalistSelectionPressure.secondOpinionDisagreementCases).toBe(1);
    expect(saved.finalistSelectionPressure.repeatedTasks).toHaveLength(0);
    expect(saved.finalistSelectionPressure.repeatedSources).toHaveLength(0);
    expect(saved.finalistSelectionPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath: "docs/RELEASE_PLAN.md",
        occurrenceCount: 2,
      }),
    ]);
    expect(saved.finalistSelectionPressure.repeatedStrategySets).toEqual([
      expect.objectContaining({
        strategyLabels: ["Minimal Change"],
        occurrenceCount: 2,
      }),
    ]);
    expect(saved.finalistSelectionPressure.repeatedJudgingCriteriaSets).toEqual([
      expect.objectContaining({
        judgingCriteria: ["Avoid unverified requirements", "Preserve release-plan structure"],
        occurrenceCount: 2,
      }),
    ]);
    expect(saved.finalistSelectionPressure.coverageBlindSpots).toHaveLength(0);
    expect(saved.finalistSelectionPressure.inspectionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "failure-analysis",
          runId: "run_selection_abstain",
        }),
        expect.objectContaining({
          artifactKind: "winner-selection-second-opinion",
          runId: "run_low_confidence",
          path: getSecondOpinionWinnerSelectionPath(cwd, "run_low_confidence"),
        }),
        expect.objectContaining({
          artifactKind: "winner-selection",
          runId: "run_low_confidence",
        }),
        expect.objectContaining({
          artifactKind: "comparison-json",
          runId: "run_low_confidence",
        }),
      ]),
    );
    expect(saved.finalistSelectionPressure.promotionSignal).toEqual(
      expect.objectContaining({
        shouldPromote: true,
        distinctRunCount: 2,
      }),
    );
    expect(saved.finalistSelectionPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "The same target artifact accumulated repeated finalist-selection pressure across consultations.",
        "The same finalist strategy mix accumulated repeated finalist-selection pressure across consultations.",
        "The same judging-criteria set accumulated repeated finalist-selection pressure across consultations.",
      ]),
    );
    expect(saved.finalistSelectionPressure.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "judge-abstain",
          runId: "run_selection_abstain",
          candidateIds: ["cand-01", "cand-02"],
          artifactPaths: expect.objectContaining({
            failureAnalysisPath: expect.stringContaining(
              ".oraculum/runs/run_selection_abstain/reports/failure-analysis.json",
            ),
            winnerSelectionPath: expect.stringContaining(
              ".oraculum/runs/run_selection_abstain/reports/winner-selection.json",
            ),
          }),
        }),
        expect.objectContaining({
          kind: "low-confidence-recommendation",
          runId: "run_low_confidence",
          candidateIds: ["cand-low"],
          confidence: "low",
          manualReviewRecommended: true,
          artifactPaths: expect.objectContaining({
            secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
              cwd,
              "run_low_confidence",
            ),
          }),
        }),
        expect.objectContaining({
          kind: "second-opinion-disagreement",
          runId: "run_low_confidence",
          candidateIds: ["cand-low"],
          confidence: "low",
          manualReviewRecommended: true,
          artifactPaths: expect.objectContaining({
            secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
              cwd,
              "run_low_confidence",
            ),
          }),
        }),
      ]),
    );
    expect(summary).toContain(
      "Artifact coverage: preflight-readiness=0 preflight-fallback=0 clarify-follow-up=0 comparison=2 winner-selection=2 failure-analysis=1 research-brief=0 manual-review=2",
    );
    expect(summary).toContain(
      "Finalist evidence coverage: targets=5 comparison=5 winner-selection=5 failure-analysis=3 research-brief=0 manual-review=5",
    );
    expect(summary).toContain(
      "Finalist metadata: validation-gaps=0 research-current=0 research-stale=0 research-unknown=2 research-conflicts=0 rerun=0 judging-criteria=2",
    );
    expect(summary).toContain("Clarify promotion signal: hold");
    expect(summary).toContain("Finalist promotion signal: promote");
    expect(summary).toContain("inspect next:");
    expect(summary).toContain("failure-analysis.json");
    expect(summary).toContain("winner-selection.json");
    expect(summary).toContain("Repeated finalist strategy sets:");
    expect(summary).toContain("Repeated judging criteria sets:");
    expect(summary).toContain(
      "Avoid unverified requirements + Preserve release-plan structure: 2 consultations",
    );
    expect(summary).toContain("Minimal Change: 2 consultations");
    expect(summary).toContain(`Artifact: ${path}`);
    expect(summary).toContain(
      "Finalist selection pressure: total=5 finalists-without-recommendation=1 judge-abstain=1 manual-crowning=1 low-confidence=1 second-opinion-disagreement=1",
    );
  });
  it("reports missing second-opinion artifacts for low-confidence finalist pressure", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createRecommendedPressureManifest("run_missing_second_opinion", {
        taskPacketOverrides: {
          title: "Finalize release plan candidate",
          sourcePath: "/tmp/release-plan.md",
        },
        recommendedWinnerOverrides: {
          confidence: "low",
          summary: "cand-01 is narrowly ahead but needs review.",
        },
      }),
    );
    await writeSelectedWinnerSelection(cwd, "run_missing_second_opinion", {
      confidence: "low",
      resultSummary: "cand-01 is narrowly ahead.",
      recommendationSummary: "cand-01 edges out the alternative but remains low confidence.",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
    });
    await writeComparisonArtifacts(cwd, "run_missing_second_opinion");

    const report = await collectPressureEvidence(cwd);

    expect(report.finalistSelectionPressure.coverageGapRuns).toEqual([
      expect.objectContaining({
        runId: "run_missing_second_opinion",
        missingArtifactKinds: ["winner-selection-second-opinion"],
      }),
    ]);
    expect(report.finalistSelectionPressure.missingArtifactBreakdown).toEqual([
      expect.objectContaining({
        artifactKind: "winner-selection-second-opinion",
        consultationCount: 1,
      }),
    ]);
    expect(report.finalistSelectionPressure.coverageBlindSpots).toContain(
      "Some finalist-selection pressure cases are missing advisory second-opinion artifacts.",
    );
  });
  it("tracks second-opinion disagreement even when the primary winner is not low-confidence", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createRecommendedPressureManifest("run_high_confidence_disagreement", {
        taskPacketOverrides: {
          title: "Finalize rollout plan",
          sourcePath: "/tmp/rollout-plan.md",
          targetArtifactPath: "docs/ROLLOUT_PLAN.md",
        },
        recommendedWinnerOverrides: {
          summary: "cand-01 is the recommended survivor.",
        },
      }),
    );
    await writeSelectedWinnerSelection(cwd, "run_high_confidence_disagreement", {
      confidence: "high",
      recommendationSummary: "cand-01 preserves the rollout structure with lower risk.",
      startedAt: "2026-04-06T00:00:00.000Z",
      completedAt: "2026-04-06T00:00:01.000Z",
    });
    await writeDisagreeingSecondOpinionSelection(cwd, "run_high_confidence_disagreement", {
      triggerKinds: ["validation-gaps"],
      triggerReasons: ["Manual review is still recommended before crowning."],
      primaryConfidence: "high",
      primarySummary: "cand-01 preserves the rollout structure with lower risk.",
      resultSummary:
        "The result should stay in manual review until the remaining concerns are closed.",
      resultRunnerSummary: "Second-opinion judge abstained pending operator review.",
      advisorySummary: "Second-opinion judge withheld approval for direct crowning.",
      startedAt: "2026-04-06T00:00:02.000Z",
      completedAt: "2026-04-06T00:00:03.000Z",
    });
    await writeComparisonArtifacts(cwd, "run_high_confidence_disagreement");

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.finalistSelectionPressure.totalCases).toBe(1);
    expect(report.finalistSelectionPressure.lowConfidenceRecommendationCases).toBe(0);
    expect(report.finalistSelectionPressure.secondOpinionDisagreementCases).toBe(1);
    expect(report.finalistSelectionPressure.coverageGapRuns).toEqual([]);
    expect(report.finalistSelectionPressure.cases).toEqual([
      expect.objectContaining({
        kind: "second-opinion-disagreement",
        runId: "run_high_confidence_disagreement",
        candidateIds: ["cand-01"],
        confidence: "high",
        manualReviewRecommended: true,
        artifactPaths: expect.objectContaining({
          secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
            cwd,
            "run_high_confidence_disagreement",
          ),
        }),
      }),
    ]);
    expect(summary).toContain("second-opinion-disagreement=1");
  });
  it("tracks second-opinion unavailability as finalist pressure", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createRecommendedPressureManifest("run_unavailable_second_opinion", {
        taskPacketOverrides: {
          title: "Finalize release notes",
          sourcePath: "/tmp/release-notes.md",
          targetArtifactPath: "docs/RELEASE_NOTES.md",
        },
        recommendedWinnerOverrides: {
          summary: "cand-01 keeps the release notes consistent.",
        },
      }),
    );
    await writeSelectedWinnerSelection(cwd, "run_unavailable_second_opinion", {
      confidence: "high",
      recommendationSummary: "cand-01 keeps the release notes consistent.",
      startedAt: "2026-04-06T00:00:00.000Z",
      completedAt: "2026-04-06T00:00:01.000Z",
    });
    await writeUnavailableSecondOpinionSelection(cwd, "run_unavailable_second_opinion", {
      triggerKinds: ["low-confidence"],
      triggerReasons: ["Primary judge confidence was low."],
      primaryConfidence: "high",
      primarySummary: "cand-01 keeps the release notes consistent.",
      resultSummary: "Second-opinion judge was unavailable.",
      advisorySummary: "Second-opinion judge was unavailable, so manual review is still required.",
      startedAt: "2026-04-06T00:00:02.000Z",
      completedAt: "2026-04-06T00:00:03.000Z",
    });
    await writeComparisonArtifacts(cwd, "run_unavailable_second_opinion");

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.finalistSelectionPressure.secondOpinionDisagreementCases).toBe(1);
    expect(report.finalistSelectionPressure.coverageGapRuns).toEqual([]);
    expect(report.finalistSelectionPressure.cases).toEqual([
      expect.objectContaining({
        kind: "second-opinion-disagreement",
        runId: "run_unavailable_second_opinion",
        manualReviewRecommended: true,
        artifactPaths: expect.objectContaining({
          secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
            cwd,
            "run_unavailable_second_opinion",
          ),
        }),
      }),
    ]);
    expect(report.finalistSelectionPressure.inspectionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "winner-selection-second-opinion",
          runId: "run_unavailable_second_opinion",
          path: getSecondOpinionWinnerSelectionPath(cwd, "run_unavailable_second_opinion"),
        }),
      ]),
    );
    expect(summary).toContain("second-opinion-disagreement=1");
  });
  it("keeps pressure-local blind spots visible when unrelated consultations have stronger artifacts", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_missing_winner_selection", {
        taskPacketOverrides: {
          title: "Compare docs finalists",
          sourcePath: "/tmp/docs-finalists.md",
          targetArtifactPath: "docs/ARCHITECTURE.md",
        },
        candidates: [createCandidate("cand-a", "promoted"), createCandidate("cand-b", "promoted")],
      }),
    );

    await writeManifest(
      cwd,
      createRecommendedPressureManifest("run_clean_unrelated", {
        createdAt: "2026-04-05T00:00:00.000Z",
        taskPacketOverrides: {
          title: "Finalize onboarding guide",
          sourcePath: "/tmp/onboarding-guide.md",
          targetArtifactPath: "docs/ONBOARDING.md",
        },
      }),
    );
    await writeSelectedWinnerSelection(cwd, "run_clean_unrelated", {
      confidence: "medium",
      resultSummary: "Judge selected the safer onboarding update.",
      recommendationSummary: "cand-01 is the safer onboarding result.",
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:01.000Z",
    });

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.artifactCoverage.consultationsWithWinnerSelection).toBe(1);
    expect(report.finalistSelectionPressure.totalCases).toBe(2);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 2,
        casesWithWinnerSelection: 0,
      }),
    );
    expect(report.finalistSelectionPressure.coverageGapRuns).toEqual([
      expect.objectContaining({
        runId: "run_missing_winner_selection",
        missingArtifactKinds: ["comparison-report", "winner-selection"],
        manifestPath: getRunManifestPath(cwd, "run_missing_winner_selection"),
      }),
    ]);
    expect(report.finalistSelectionPressure.missingArtifactBreakdown).toEqual([
      {
        artifactKind: "comparison-report",
        consultationCount: 1,
      },
      {
        artifactKind: "winner-selection",
        consultationCount: 1,
      },
    ]);
    expect(report.finalistSelectionPressure.coverageBlindSpots).toContain(
      "Some finalist-selection pressure cases are missing winner-selection artifacts.",
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).toContain(
      "Some finalist-selection pressure cases are missing comparison reports.",
    );
    expect(report.finalistSelectionPressure.inspectionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "run-manifest",
          runId: "run_missing_winner_selection",
          path: getRunManifestPath(cwd, "run_missing_winner_selection"),
        }),
      ]),
    );
    expect(summary).toContain(
      "Finalist evidence coverage: targets=2 comparison=0 winner-selection=0 failure-analysis=0 research-brief=0 manual-review=2",
    );
    expect(summary).toContain("Missing finalist artifacts: comparison-report=1 winner-selection=1");
    expect(summary).toContain(
      "blind spot: Some finalist-selection pressure cases are missing winner-selection artifacts.",
    );
    expect(summary).toContain(
      "blind spot: Some finalist-selection pressure cases are missing comparison reports.",
    );
  });
  it("tracks repeated finalist strategy sets across consultations", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_strategy_set_1", {
        taskPacketOverrides: {
          title: "Compare integration finalists",
          sourcePath: "/tmp/integration-a.md",
          targetArtifactPath: "docs/INTEGRATION_PLAN.md",
        },
        candidates: [
          createCandidate("cand-a1", "promoted", {
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
          }),
          createCandidate("cand-a2", "promoted", {
            strategyId: "broad-rewrite",
            strategyLabel: "Broad Rewrite",
          }),
        ],
      }),
    );
    await writeAbstainingWinnerSelection(cwd, "run_strategy_set_1", {
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
      summary: "Judge abstained after comparing two competing integration strategies.",
      recommendation: {
        decision: "abstain",
        confidence: "medium",
        summary: "Both integration approaches expose different risks.",
      },
    });
    await writeComparisonArtifacts(cwd, "run_strategy_set_1");

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_strategy_set_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        taskPacketOverrides: {
          title: "Resolve integration finalists",
          sourcePath: "/tmp/integration-b.md",
          targetArtifactPath: "docs/INTEGRATION_PLAN.md",
        },
        candidates: [
          createCandidate("cand-b1", "promoted", {
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
          }),
          createCandidate("cand-b2", "promoted", {
            strategyId: "broad-rewrite",
            strategyLabel: "Broad Rewrite",
          }),
        ],
      }),
    );
    await writeAbstainingWinnerSelection(cwd, "run_strategy_set_2", {
      adapter: "claude-code",
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:01.000Z",
      summary: "Judge abstained again after comparing the same two strategy families.",
      recommendation: {
        decision: "abstain",
        confidence: "medium",
        summary: "The same strategy mix still leaves unresolved tradeoffs.",
      },
    });
    await writeComparisonArtifacts(cwd, "run_strategy_set_2");

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.finalistSelectionPressure.repeatedStrategySets).toEqual([
      expect.objectContaining({
        strategyLabels: ["Broad Rewrite", "Minimal Change"],
        occurrenceCount: 2,
        latestRunId: "run_strategy_set_2",
      }),
    ]);
    expect(report.finalistSelectionPressure.agentBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "codex",
          caseCount: 3,
          consultationCount: 1,
        }),
        expect.objectContaining({
          agent: "claude-code",
          caseCount: 3,
          consultationCount: 1,
        }),
      ]),
    );
    expect(report.finalistSelectionPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/INTEGRATION_PLAN.md",
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
        distinctKinds: expect.arrayContaining([
          "finalists-without-recommendation",
          "judge-abstain",
          "manual-crowning-handoff",
        ]),
      }),
    ]);
    expect(report.finalistSelectionPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "2 consultations recorded judge abstain outcomes.",
        "The same finalist strategy mix accumulated repeated finalist-selection pressure across consultations.",
        "The same finalist-selection pressure trajectory crossed multiple hosts.",
      ]),
    );
    expect(summary).toContain(
      "Finalist agents: claude-code=cases:3,consultations:1 codex=cases:3,consultations:1",
    );
    expect(summary).toContain("Pressure trajectories:");
    expect(summary).toContain(
      "target-artifact docs/INTEGRATION_PLAN.md | agents=claude-code, codex",
    );
    expect(summary).toContain("Repeated finalist strategy sets:");
    expect(summary).toContain("Broad Rewrite + Minimal Change: 2 consultations");
  });
});
