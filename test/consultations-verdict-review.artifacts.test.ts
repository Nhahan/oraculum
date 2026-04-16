import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import {
  createClarificationManifest,
  createInitializedProject,
  createManifest,
  createRecommendedManifest,
  registerConsultationsTempRootCleanup,
  toExpectedDisplayPath,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation verdict review artifact availability", () => {
  it("treats invalid clarify follow-up artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_invalid_clarify_follow_up");
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);
    await writeFile(getClarifyFollowUpPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
        clarifyFollowUpPath: getClarifyFollowUpPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- clarify follow-up: not available");
    expect(summary).not.toContain(
      "- inspect the persisted clarify follow-up: .oraculum/runs/run_invalid_clarify_follow_up/reports/clarify-follow-up.json.",
    );
    expect(review.artifactAvailability.clarifyFollowUp).toBe(false);
    expect(review.clarifyScopeKeyType).toBeUndefined();
    expect(review.clarifyScopeKey).toBeUndefined();
    expect(review.clarifyRepeatedCaseCount).toBeUndefined();
    expect(review.clarifyFollowUpQuestion).toBeUndefined();
    expect(review.clarifyMissingResultContract).toBeUndefined();
    expect(review.clarifyMissingJudgingBasis).toBeUndefined();
  });

  it("treats invalid preflight-readiness artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_invalid_preflight_readiness");
    await writeManifest(cwd, manifest);
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "not-json\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- preflight readiness: not available");
    expect(review.artifactAvailability.preflightReadiness).toBe(false);
  });

  it("treats legacy preflight-readiness artifacts that omit runId as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_legacy_preflight_readiness");
    await writeManifest(cwd, manifest);
    await writeFile(
      getPreflightReadinessPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Legacy preflight readiness remains usable.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- preflight readiness: not available");
    expect(review.artifactAvailability.preflightReadiness).toBe(false);
  });

  it("treats legacy research brief and profile selection artifacts that omit runId as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_legacy_research_profile",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      recommendedWinner: undefined,
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
      preflight: {
        decision: "external-research-required",
        confidence: "medium",
        summary: "Research is still required.",
        researchPosture: "repo-plus-external-docs",
        researchQuestion: "What do the official docs require?",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getResearchBriefPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question: "What do the official docs require?",
          confidence: "medium",
          researchPosture: "external-research-required",
          summary: "Legacy research brief remains parseable but should not be replayed.",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
            artifactKind: "document",
            targetArtifactPath: "docs/PRD.md",
          },
          sources: [],
          claims: [],
          versionNotes: [],
          unresolvedConflicts: [],
          conflictHandling: "accepted",
          notes: [],
          signalSummary: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getProfileSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            validationProfileId: "library",
            confidence: "high",
            validationSummary: "Legacy profile selection remains parseable.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            selectedCommandIds: [],
            validationGaps: [],
          },
          appliedSelection: {
            profileId: "library",
            validationProfileId: "library",
            confidence: "high",
            source: "llm-recommendation",
            summary: "Legacy profile selection remains parseable.",
            validationSummary: "Legacy profile selection remains parseable.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            oracleIds: ["lint-fast"],
            missingCapabilities: [],
            validationGaps: [],
            signals: ["package-export"],
            validationSignals: ["package-export"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        researchBriefPath: getResearchBriefPath(cwd, manifest.id),
        profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.researchBrief).toBe(false);
    expect(review.artifactAvailability.profileSelection).toBe(false);
    expect(review.researchRerunInputPath).toBeUndefined();
  });

  it("treats invalid second-opinion artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createRecommendedManifest("run_invalid_second_opinion", {
      candidateOverrides: {
        workspaceDir: "/tmp/cand-01",
      },
      outcomeOverrides: {
        verificationLevel: "standard",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getSecondOpinionWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- second-opinion winner selection: not available");
    expect(summary).toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(summary).not.toContain("Second-opinion judge:");
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(false);
    expect(review.secondOpinionAgreement).toBeUndefined();
    expect(review.secondOpinionAdapter).toBeUndefined();
    expect(review.secondOpinionSummary).toBeUndefined();
    expect(review.manualReviewRecommended).toBe(false);
  });

  it("treats invalid comparison reports as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_comparison_report",
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonJsonPath(cwd, manifest.id), "{}\n", "utf8");

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonJsonPath: getFinalistComparisonJsonPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("falls back to markdown when comparison json is malformed in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_json_with_markdown_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonJsonPath(cwd, manifest.id), "{\n", "utf8");
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, manifest.id),
      `# Finalist Comparison\n\n- Run: ${manifest.id}\n\nThe markdown report is still usable.\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonJsonPath: getFinalistComparisonJsonPath(cwd, manifest.id),
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain(
      `- comparison report: ${toExpectedDisplayPath(cwd, getFinalistComparisonMarkdownPath(cwd, manifest.id))}`,
    );
    expect(summary).not.toContain(
      toExpectedDisplayPath(cwd, getFinalistComparisonJsonPath(cwd, manifest.id)),
    );
    expect(review.artifactAvailability.comparisonReport).toBe(true);
  });

  it("does not report comparison availability from a missing markdown path alone", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_missing_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("treats blank comparison markdown as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_blank_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonMarkdownPath(cwd, manifest.id), "   \n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("open the comparison report above");
    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("treats headerless comparison markdown as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_headerless_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, manifest.id),
      "# Finalist Comparison\n\nLegacy report without a run header.\n",
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("open the comparison report above");
    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("surfaces a valid comparison json path when markdown is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_json_only_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getFinalistComparisonJsonPath(cwd, manifest.id),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId: manifest.id,
          generatedAt: "2026-04-04T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended survivor",
          finalistCount: 2,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [
            {
              candidateId: "cand-01",
              strategyLabel: "Minimal Change",
              summary: "cand-01 keeps the diff small.",
              artifactKinds: ["patch"],
              verdicts: [],
              changedPaths: ["docs/TASK.md"],
              changeSummary: {
                mode: "none",
                changedPathCount: 1,
                createdPathCount: 0,
                removedPathCount: 0,
                modifiedPathCount: 1,
              },
              witnessRollup: {
                witnessCount: 0,
                warningOrHigherCount: 0,
                repairableCount: 0,
                repairHints: [],
                riskSummaries: [],
                keyWitnesses: [],
              },
              repairSummary: {
                attemptCount: 0,
                repairedRounds: [],
              },
              status: "promoted",
              verdictCounts: {
                pass: 0,
                repairable: 0,
                fail: 0,
                skip: 0,
                info: 0,
                warning: 0,
                error: 0,
                critical: 0,
              },
            },
            {
              candidateId: "cand-02",
              strategyLabel: "Safety First",
              summary: "cand-02 carries broader safeguards.",
              artifactKinds: ["patch"],
              verdicts: [],
              changedPaths: ["docs/TASK.md"],
              changeSummary: {
                mode: "none",
                changedPathCount: 1,
                createdPathCount: 0,
                removedPathCount: 0,
                modifiedPathCount: 1,
              },
              witnessRollup: {
                witnessCount: 0,
                warningOrHigherCount: 0,
                repairableCount: 0,
                repairHints: [],
                riskSummaries: [],
                keyWitnesses: [],
              },
              repairSummary: {
                attemptCount: 0,
                repairedRounds: [],
              },
              status: "promoted",
              verdictCounts: {
                pass: 0,
                repairable: 0,
                fail: 0,
                skip: 0,
                info: 0,
                warning: 0,
                error: 0,
                critical: 0,
              },
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      `- comparison report: ${toExpectedDisplayPath(cwd, getFinalistComparisonJsonPath(cwd, manifest.id))}`,
    );
    expect(summary).toContain(
      "- inspect the comparison first. The shared `orc crown` path only crowns a recommended survivor.",
    );
  });

  it("does not tell operators to inspect a missing comparison report when finalists survived", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_missing_finalist_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain(
      "- compare the surviving finalists manually before crowning because no comparison report is available yet.",
    );
    expect(summary).not.toContain("- inspect the comparison first.");
  });

  it("treats invalid winner-selection artifacts as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_winner_selection",
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
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- winner selection: not available yet");
    expect(review.artifactAvailability.winnerSelection).toBe(false);
  });

  it("treats invalid failure-analysis artifacts as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_failure_analysis",
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "failed",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFailureAnalysisPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        failureAnalysisPath: getFailureAnalysisPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- failure analysis: not available");
    expect(summary).not.toContain(
      "- investigate the persisted failure analysis: .oraculum/runs/run_invalid_failure_analysis/reports/failure-analysis.json.",
    );
    expect(review.artifactAvailability.failureAnalysis).toBe(false);
  });
});
