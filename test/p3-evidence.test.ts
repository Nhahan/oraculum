import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { agentJudgeResultSchema } from "../src/adapters/types.js";
import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getP3EvidencePath,
  getRunManifestPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import type { RunManifest } from "../src/domain/run.js";
import { failureAnalysisSchema } from "../src/services/failure-analysis.js";
import {
  collectP3Evidence,
  p3EvidenceReportSchema,
  renderP3EvidenceSummary,
  writeP3EvidenceReport,
} from "../src/services/p3-evidence.js";
import { initializeProject } from "../src/services/project.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("P3 evidence collection", () => {
  it("collects recurring clarify pressure from saved consultations", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_clarify_1", {
        taskPacket: {
          id: "task",
          title: "Draft session plan",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The target sections are unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which sections are required in the session plan?",
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
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_clarify_1", "reports", "preflight-readiness.json"),
      `${JSON.stringify({ llmFailure: "runtime unavailable" }, null, 2)}\n`,
      "utf8",
    );
    await writeManifest(
      cwd,
      createManifest("run_clarify_2", {
        createdAt: "2026-04-06T00:00:00.000Z",
        agent: "claude-code",
        taskPacket: {
          id: "task",
          title: "Finalize session plan",
          sourceKind: "task-note",
          sourcePath: "/tmp/task-v2.md",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official release guidance is required before execution.",
          researchPosture: "external-research-required",
          researchQuestion:
            "What do the official docs require for the current release plan format?",
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "missing-capability",
        },
      }),
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_clarify_2", "reports", "preflight-readiness.json"),
      `${JSON.stringify({ llmSkipped: true }, null, 2)}\n`,
      "utf8",
    );
    await writeManifest(
      cwd,
      createManifest("run_clarify_3", {
        createdAt: "2026-04-07T00:00:00.000Z",
        taskPacket: {
          id: "task",
          title: "Review session plan",
          sourceKind: "task-note",
          sourcePath: "/tmp/task-v3.md",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The target sections are still unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which sections are required in the session plan?",
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
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_clarify_3", "reports", "preflight-readiness.json"),
      `${JSON.stringify({ llmFailure: "host timeout" }, null, 2)}\n`,
      "utf8",
    );

    const report = await collectP3Evidence(cwd);

    expect(report.consultationCount).toBe(3);
    expect(report.artifactCoverage).toEqual(
      expect.objectContaining({
        consultationsWithPreflightReadiness: 3,
        consultationsWithPreflightFallback: 3,
        consultationsWithManualReviewRecommendation: 3,
      }),
    );
    expect(report.clarifyPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 3,
        casesWithTargetArtifact: 3,
        casesWithPreflightReadiness: 3,
        casesWithPreflightFallback: 3,
        casesWithResearchBrief: 0,
        casesWithManualReviewRecommendation: 3,
      }),
    );
    expect(report.clarifyPressure.agentBreakdown).toEqual([
      expect.objectContaining({
        agent: "codex",
        caseCount: 2,
        consultationCount: 2,
      }),
      expect.objectContaining({
        agent: "claude-code",
        caseCount: 1,
        consultationCount: 1,
      }),
    ]);
    expect(report.clarifyPressure.totalCases).toBe(3);
    expect(report.clarifyPressure.needsClarificationCases).toBe(2);
    expect(report.clarifyPressure.externalResearchRequiredCases).toBe(1);
    expect(report.clarifyPressure.repeatedTasks).toEqual([]);
    expect(report.clarifyPressure.repeatedSources).toEqual([]);
    expect(report.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath: "docs/SESSION_PLAN.md",
        occurrenceCount: 3,
        latestRunId: "run_clarify_3",
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/SESSION_PLAN.md",
        occurrenceCount: 3,
        agents: ["claude-code", "codex"],
        distinctKinds: expect.arrayContaining(["clarify-needed", "external-research-required"]),
      }),
    ]);
    expect(report.clarifyPressure.recurringReasons).toEqual([
      expect.objectContaining({
        label: "Which sections are required in the session plan?",
        occurrenceCount: 2,
      }),
    ]);
    expect(report.clarifyPressure.coverageBlindSpots).toEqual([
      "Clarify evidence is dominated by fallback preflight results instead of structured runtime recommendations.",
      "External-research blockers have no persisted research-brief artifacts yet.",
    ]);
    expect(report.clarifyPressure.coverageGapRuns).toEqual([
      expect.objectContaining({
        runId: "run_clarify_2",
        missingArtifactKinds: ["research-brief"],
        manifestPath: getRunManifestPath(cwd, "run_clarify_2"),
      }),
    ]);
    expect(report.clarifyPressure.missingArtifactBreakdown).toEqual([
      {
        artifactKind: "research-brief",
        consultationCount: 1,
      },
    ]);
    expect(report.clarifyPressure.inspectionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "run-manifest",
          runId: "run_clarify_2",
          path: getRunManifestPath(cwd, "run_clarify_2"),
        }),
        expect.objectContaining({
          artifactKind: "preflight-readiness",
          runId: "run_clarify_3",
        }),
        expect.objectContaining({
          artifactKind: "preflight-readiness",
          runId: "run_clarify_2",
        }),
      ]),
    );
    expect(report.clarifyPressure.promotionSignal).toEqual(
      expect.objectContaining({
        shouldPromote: true,
        distinctRunCount: 3,
      }),
    );
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "3 consultations ended in clarify pressure.",
        "The same target artifact accumulated repeated clarify pressure across consultations.",
        "The same clarify scope moved across multiple pressure kinds.",
        "The same clarify pressure trajectory crossed multiple hosts.",
        "The same clarification or research blocker repeated across multiple consultations.",
      ]),
    );
    expect(report.clarifyPressure.cases[0]).toEqual(
      expect.objectContaining({
        kind: "clarify-needed",
        agent: "codex",
        question: "Which sections are required in the session plan?",
        artifactPaths: expect.objectContaining({
          preflightReadinessPath: expect.stringContaining(
            ".oraculum/runs/run_clarify_3/reports/preflight-readiness.json",
          ),
        }),
      }),
    );
    const clarifySummary = renderP3EvidenceSummary(report);
    expect(clarifySummary).toContain("Missing clarify artifacts: research-brief=1");
  });

  it("collects finalist-selection pressure and writes a replayable report artifact", async () => {
    const cwd = await createInitializedProject();

    const abstainManifest = createManifest("run_selection_abstain", {
      taskPacket: {
        id: "task",
        title: "Compare release plan finalists",
        sourceKind: "task-note",
        sourcePath: "/tmp/release-plan.md",
        artifactKind: "document",
        targetArtifactPath: "docs/RELEASE_PLAN.md",
      },
      candidateCount: 2,
      candidates: [createCandidate("cand-01", "promoted"), createCandidate("cand-02", "promoted")],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, abstainManifest);
    await writeWinnerSelection(cwd, "run_selection_abstain", {
      runId: "run_selection_abstain",
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:02.000Z",
      exitCode: 0,
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

    const lowConfidenceManifest = createManifest("run_low_confidence", {
      createdAt: "2026-04-05T00:00:00.000Z",
      taskPacket: {
        id: "task",
        title: "Finalize release plan",
        sourceKind: "task-note",
        sourcePath: "/tmp/release-plan-v2.md",
        artifactKind: "document",
        targetArtifactPath: "docs/RELEASE_PLAN.md",
      },
      candidates: [createCandidate("cand-low", "exported")],
      recommendedWinner: {
        candidateId: "cand-low",
        confidence: "low",
        source: "llm-judge",
        summary: "cand-low is the least risky option, but the evidence is still weak.",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-low",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, lowConfidenceManifest);
    await writeWinnerSelection(cwd, "run_low_confidence", {
      runId: "run_low_confidence",
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:02.000Z",
      exitCode: 0,
      summary: "Judge selected a low-confidence winner.",
      recommendation: {
        decision: "select",
        candidateId: "cand-low",
        confidence: "low",
        summary: "cand-low wins narrowly under the current judging criteria.",
        judgingCriteria: ["Preserve release-plan structure", "Avoid unverified requirements"],
      },
    });
    await writeComparisonArtifacts(cwd, "run_low_confidence");

    const { path, report } = await writeP3EvidenceReport(cwd);
    const saved = p3EvidenceReportSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    const summary = renderP3EvidenceSummary(report, { artifactPath: path });

    expect(path).toBe(getP3EvidencePath(cwd));
    expect(saved.artifactCoverage).toEqual(
      expect.objectContaining({
        consultationsWithPreflightReadiness: 0,
        consultationsWithPreflightFallback: 0,
        consultationsWithComparisonReport: 2,
        consultationsWithWinnerSelection: 2,
        consultationsWithFailureAnalysis: 1,
        consultationsWithManualReviewRecommendation: 1,
      }),
    );
    expect(saved.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 4,
        casesWithTargetArtifact: 4,
        casesWithComparisonReport: 4,
        casesWithWinnerSelection: 4,
        casesWithFailureAnalysis: 3,
        casesWithManualReviewRecommendation: 3,
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
    expect(saved.finalistSelectionPressure.totalCases).toBe(4);
    expect(saved.finalistSelectionPressure.finalistsWithoutRecommendationCases).toBe(1);
    expect(saved.finalistSelectionPressure.judgeAbstainCases).toBe(1);
    expect(saved.finalistSelectionPressure.manualCrowningCases).toBe(1);
    expect(saved.finalistSelectionPressure.lowConfidenceRecommendationCases).toBe(1);
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
        }),
      ]),
    );
    expect(summary).toContain(
      "Artifact coverage: preflight-readiness=0 preflight-fallback=0 comparison=2 winner-selection=2 failure-analysis=1 research-brief=0 manual-review=1",
    );
    expect(summary).toContain(
      "Finalist evidence coverage: targets=4 comparison=4 winner-selection=4 failure-analysis=3 research-brief=0 manual-review=3",
    );
    expect(summary).toContain(
      "Finalist metadata: validation-gaps=0 research-current=0 research-stale=0 research-unknown=2 research-conflicts=0 rerun=0 judging-criteria=2",
    );
    expect(summary).toContain("Clarify promotion signal: hold");
    expect(summary).toContain("Finalist promotion signal: open-P3");
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
    expect(summary).toContain("Finalist selection pressure: total=4");
  });

  it("tracks clarify metadata from stale research and unresolved conflicts", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_research_clarify", {
        taskPacket: {
          id: "task",
          title: "Audit vendor rollout guidance",
          sourceKind: "task-note",
          sourcePath: "/tmp/vendor-rollout.md",
          artifactKind: "document",
          targetArtifactPath: "docs/VENDOR_ROLLOUT.md",
          researchContext: {
            question: "Which rollout guidance is current?",
            summary: "The official guidance diverges across two recent documents.",
            confidence: "medium",
            signalSummary: ["official rollout guidance conflict"],
            sources: [
              {
                kind: "official-doc",
                title: "Rollout guide v1",
                locator: "https://example.test/rollout-v1",
              },
              {
                kind: "official-doc",
                title: "Rollout guide v2",
                locator: "https://example.test/rollout-v2",
              },
            ],
            claims: [
              {
                statement: "The rollout cutoff changed in the latest guidance.",
                sourceLocators: ["https://example.test/rollout-v2"],
              },
            ],
            versionNotes: ["v1 and v2 disagree on the cutoff date."],
            unresolvedConflicts: ["The official docs disagree on the rollout cutoff date."],
            conflictHandling: "manual-review-required",
          },
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official rollout guidance still conflicts and needs bounded research.",
          researchPosture: "external-research-required",
          researchQuestion: "Which rollout cutoff date is current in the official guidance?",
          researchBasisDrift: true,
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "missing-capability",
        },
      }),
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_research_clarify", "reports", "preflight-readiness.json"),
      "{}\n",
      "utf8",
    );

    const report = await collectP3Evidence(cwd);
    const summary = renderP3EvidenceSummary(report);

    expect(report.clarifyPressure.metadataCoverage).toEqual(
      expect.objectContaining({
        consultationCount: 1,
        consultationsWithValidationGaps: 1,
        consultationsWithCurrentResearchBasis: 0,
        consultationsWithStaleResearchBasis: 1,
        consultationsWithUnknownResearchBasis: 0,
        consultationsWithResearchConflicts: 1,
        consultationsWithResearchRerunRecommended: 1,
        consultationsWithJudgingCriteria: 0,
      }),
    );
    expect(report.clarifyPressure.cases).toEqual([
      expect.objectContaining({
        runId: "run_research_clarify",
        researchBasisStatus: "stale",
        researchConflictHandling: "manual-review-required",
        researchRerunRecommended: true,
        validationPosture: "validation-gaps",
      }),
    ]);
    expect(summary).toContain(
      "Clarify metadata: validation-gaps=1 research-current=0 research-stale=1 research-unknown=0 research-conflicts=1 rerun=1",
    );
  });

  it("keeps pressure-local blind spots visible when unrelated consultations have stronger artifacts", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_missing_winner_selection", {
        taskPacket: {
          id: "task",
          title: "Compare docs finalists",
          sourceKind: "task-note",
          sourcePath: "/tmp/docs-finalists.md",
          artifactKind: "document",
          targetArtifactPath: "docs/ARCHITECTURE.md",
        },
        candidateCount: 2,
        candidates: [createCandidate("cand-a", "promoted"), createCandidate("cand-b", "promoted")],
        outcome: {
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
          finalistCount: 2,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    );

    await writeManifest(
      cwd,
      createManifest("run_clean_unrelated", {
        createdAt: "2026-04-05T00:00:00.000Z",
        taskPacket: {
          id: "task",
          title: "Finalize onboarding guide",
          sourceKind: "task-note",
          sourcePath: "/tmp/onboarding-guide.md",
          artifactKind: "document",
          targetArtifactPath: "docs/ONBOARDING.md",
        },
      }),
    );
    await writeWinnerSelection(cwd, "run_clean_unrelated", {
      runId: "run_clean_unrelated",
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:01.000Z",
      exitCode: 0,
      summary: "Judge selected the safer onboarding update.",
      recommendation: {
        decision: "select",
        candidateId: "cand-01",
        confidence: "medium",
        summary: "cand-01 is the safer onboarding result.",
      },
    });

    const report = await collectP3Evidence(cwd);
    const summary = renderP3EvidenceSummary(report);

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

  it("tracks repeated task sources when titles drift without a target artifact", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_source_clarify_1", {
        taskPacket: {
          id: "task",
          title: "Draft operator memo",
          sourceKind: "task-note",
          sourcePath: "/tmp/operator-memo.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The operator memo audience is unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Who is the intended operator audience?",
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
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_source_clarify_1", "reports", "preflight-readiness.json"),
      "{}\n",
      "utf8",
    );

    await writeManifest(
      cwd,
      createManifest("run_source_clarify_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        taskPacket: {
          id: "task",
          title: "Revise operator memo",
          sourceKind: "task-note",
          sourcePath: "/tmp/operator-memo.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The operator memo audience is still unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Who is the intended operator audience?",
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
    );
    await writeFile(
      join(cwd, ".oraculum", "runs", "run_source_clarify_2", "reports", "preflight-readiness.json"),
      "{}\n",
      "utf8",
    );

    const report = await collectP3Evidence(cwd);
    const summary = renderP3EvidenceSummary(report);

    expect(report.clarifyPressure.repeatedTasks).toEqual([]);
    expect(report.clarifyPressure.repeatedTargets).toEqual([]);
    expect(report.clarifyPressure.repeatedSources).toEqual([
      expect.objectContaining({
        taskSourcePath: "/tmp/operator-memo.md",
        occurrenceCount: 2,
        latestRunId: "run_source_clarify_2",
      }),
    ]);
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "The same task source accumulated repeated clarify pressure across consultations.",
        "The same clarification or research blocker repeated across multiple consultations.",
      ]),
    );
    expect(summary).toContain("Repeated task sources:");
    expect(summary).toContain("/tmp/operator-memo.md: 2 cases [clarify-needed]");
  });

  it("does not promote clarify pressure from unrelated multi-host cases alone", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_unrelated_clarify_codex", {
        taskPacket: {
          id: "task",
          title: "Draft rollout note",
          sourceKind: "task-note",
          sourcePath: "/tmp/rollout-note.md",
          artifactKind: "document",
          targetArtifactPath: "docs/ROLLOUT.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The rollout audience is unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Who is the rollout audience?",
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
    );

    await writeManifest(
      cwd,
      createManifest("run_unrelated_clarify_claude", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        taskPacket: {
          id: "task",
          title: "Draft launch checklist",
          sourceKind: "task-note",
          sourcePath: "/tmp/launch-checklist.md",
          artifactKind: "document",
          targetArtifactPath: "docs/LAUNCH.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The launch milestones are unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which launch milestones matter most?",
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
    );

    const report = await collectP3Evidence(cwd);

    expect(report.clarifyPressure.agentBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "codex", caseCount: 1 }),
        expect.objectContaining({ agent: "claude-code", caseCount: 1 }),
      ]),
    );
    expect(report.clarifyPressure.pressureTrajectories).toEqual([]);
    expect(report.clarifyPressure.promotionSignal).toEqual(
      expect.objectContaining({
        shouldPromote: false,
        distinctRunCount: 2,
      }),
    );
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual([]);
  });

  it("tracks same-kind cross-host clarify trajectories on the same scope", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_clarify_same_kind_1", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "codex",
        taskPacket: {
          id: "task",
          title: "Draft weekly evidence note",
          sourceKind: "task-note",
          sourcePath: "/tmp/p3-weekly-a.md",
          artifactKind: "document",
          targetArtifactPath: "docs/P3_WEEKLY.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "high",
          summary: "The audience and required sections are unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which audience and required sections should this note target?",
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
    );

    await writeManifest(
      cwd,
      createManifest("run_clarify_same_kind_2", {
        createdAt: "2026-04-06T00:00:00.000Z",
        agent: "claude-code",
        taskPacket: {
          id: "task",
          title: "Fill weekly evidence note",
          sourceKind: "task-note",
          sourcePath: "/tmp/p3-weekly-b.md",
          artifactKind: "document",
          targetArtifactPath: "docs/P3_WEEKLY.md",
        },
        candidateCount: 0,
        rounds: [],
        candidates: [],
        preflight: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The same document contract is still unresolved.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which audience and required sections should this note target?",
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
    );

    const report = await collectP3Evidence(cwd);

    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/P3_WEEKLY.md",
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
        distinctKinds: ["clarify-needed"],
      }),
    ]);
  });

  it("tracks repeated finalist strategy sets across consultations", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createManifest("run_strategy_set_1", {
        taskPacket: {
          id: "task",
          title: "Compare integration finalists",
          sourceKind: "task-note",
          sourcePath: "/tmp/integration-a.md",
          artifactKind: "document",
          targetArtifactPath: "docs/INTEGRATION_PLAN.md",
        },
        candidateCount: 2,
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
        outcome: {
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
          finalistCount: 2,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    );
    await writeWinnerSelection(cwd, "run_strategy_set_1", {
      runId: "run_strategy_set_1",
      adapter: "codex",
      status: "completed",
      startedAt: "2026-04-04T00:00:00.000Z",
      completedAt: "2026-04-04T00:00:01.000Z",
      exitCode: 0,
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
      createManifest("run_strategy_set_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        taskPacket: {
          id: "task",
          title: "Resolve integration finalists",
          sourceKind: "task-note",
          sourcePath: "/tmp/integration-b.md",
          artifactKind: "document",
          targetArtifactPath: "docs/INTEGRATION_PLAN.md",
        },
        candidateCount: 2,
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
        outcome: {
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
          finalistCount: 2,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    );
    await writeWinnerSelection(cwd, "run_strategy_set_2", {
      runId: "run_strategy_set_2",
      adapter: "claude-code",
      status: "completed",
      startedAt: "2026-04-05T00:00:00.000Z",
      completedAt: "2026-04-05T00:00:01.000Z",
      exitCode: 0,
      summary: "Judge abstained again after comparing the same two strategy families.",
      recommendation: {
        decision: "abstain",
        confidence: "medium",
        summary: "The same strategy mix still leaves unresolved tradeoffs.",
      },
    });
    await writeComparisonArtifacts(cwd, "run_strategy_set_2");

    const report = await collectP3Evidence(cwd);
    const summary = renderP3EvidenceSummary(report);

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

async function createInitializedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "oraculum-p3-evidence-"));
  tempRoots.push(cwd);
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function writeManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", manifest.id, "reports"), { recursive: true });
  await writeFile(
    getRunManifestPath(cwd, manifest.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeWinnerSelection(
  cwd: string,
  runId: string,
  value: z.input<typeof agentJudgeResultSchema>,
): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getWinnerSelectionPath(cwd, runId),
    `${JSON.stringify(agentJudgeResultSchema.parse(value), null, 2)}\n`,
    "utf8",
  );
}

async function writeFailureAnalysis(
  cwd: string,
  runId: string,
  value: z.input<typeof failureAnalysisSchema>,
): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    join(cwd, ".oraculum", "runs", runId, "reports", "failure-analysis.json"),
    `${JSON.stringify(failureAnalysisSchema.parse(value), null, 2)}\n`,
    "utf8",
  );
}

async function writeComparisonArtifacts(cwd: string, runId: string): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getFinalistComparisonJsonPath(cwd, runId),
    `${JSON.stringify({ finalists: [] }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(getFinalistComparisonMarkdownPath(cwd, runId), "# Finalist Comparison\n", "utf8");
}

function createManifest(runId: string, overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    id: runId,
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
    rounds: [
      {
        id: "fast",
        label: "Fast",
        status: "completed",
        verdictCount: 1,
        survivorCount: 1,
        eliminatedCount: 0,
      },
    ],
    candidates: [createCandidate("cand-01", "exported")],
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
    ...overrides,
  };
}

function createCandidate(
  candidateId: string,
  status: RunManifest["candidates"][number]["status"],
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return {
    id: candidateId,
    strategyId: "minimal-change",
    strategyLabel: "Minimal Change",
    status,
    workspaceDir: `/tmp/${candidateId}`,
    taskPacketPath: `/tmp/${candidateId}.task-packet.json`,
    repairCount: 0,
    repairedRounds: [],
    createdAt: "2026-04-04T00:00:00.000Z",
    ...overrides,
  };
}
