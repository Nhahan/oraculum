import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getFailureAnalysisPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import {
  createInitializedProject,
  createManifest,
  createRecommendedManifest,
  registerConsultationsTempRootCleanup,
  writeManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation verdict review artifact availability: winner and failure", () => {
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
