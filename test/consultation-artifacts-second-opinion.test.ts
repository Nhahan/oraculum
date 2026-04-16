import { describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import { exportPlanSchema } from "../src/domain/run.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../src/services/finalist-judge.js";
import {
  createInitializedProject,
  ensureReportsDir,
  registerConsultationArtifactsTempRootCleanup,
  resolveBoth,
  writeComparisonArtifacts,
  writeJsonArtifact,
} from "./helpers/consultation-artifacts.js";

registerConsultationArtifactsTempRootCleanup();

describe("consultation artifact second-opinion handling", () => {
  it("marks second-opinion disagreements as manual-review-required", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-disagree";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId,
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary finalist recommendation is low-confidence."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 narrowly leads the primary recommendation.",
        },
        result: {
          runId,
          adapter: "claude-code",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Second opinion prefers cand-02.",
          recommendation: {
            decision: "select",
            candidateId: "cand-02",
            confidence: "medium",
            summary: "cand-02 is the safer recommendation.",
          },
          artifacts: [],
        },
        agreement: "disagrees-candidate",
        advisorySummary: "The second opinion selects a different finalist.",
      }),
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
    }
  });

  it("keeps agrees-select second opinions out of manual-review mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-agrees";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId,
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary finalist recommendation is low-confidence."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 narrowly leads the primary recommendation.",
        },
        result: {
          runId,
          adapter: "claude-code",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Second opinion agrees with cand-01.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "medium",
            summary: "cand-01 remains the safest recommendation.",
          },
          artifacts: [],
        },
        agreement: "agrees-select",
        advisorySummary: "The second opinion agrees with the primary recommendation.",
      }),
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(false);
    }
  });

  it("treats unavailable second opinions as manual-review-required", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-unavailable";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId,
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary finalist recommendation is low-confidence."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 narrowly leads the primary recommendation.",
        },
        result: {
          runId,
          adapter: "claude-code",
          status: "failed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 1,
          summary: "Second opinion was unavailable.",
          artifacts: [],
        },
        agreement: "unavailable",
        advisorySummary: "The second opinion was unavailable, so manual review is still required.",
      }),
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
    }
  });

  it("keeps comparison and crowning artifacts available while second-opinion unavailability still requires manual review", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-unavailable-second-opinion-with-export";
    await writeComparisonArtifacts(cwd, runId);
    await writeJsonArtifact(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId,
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "medium",
          summary: "cand-01 remains the primary recommendation.",
        },
        result: {
          runId,
          adapter: "claude-code",
          status: "failed",
          startedAt: "2026-04-15T00:00:00.000Z",
          completedAt: "2026-04-15T00:00:01.000Z",
          exitCode: 1,
          summary: "Second-opinion judge was unavailable.",
          artifacts: [],
        },
        agreement: "unavailable",
        advisorySummary: "Manual review is still required because the second opinion failed.",
      }),
    );
    await writeJsonArtifact(
      getExportPlanPath(cwd, runId),
      exportPlanSchema.parse({
        runId,
        winnerId: "cand-01",
        branchName: `orc/${runId}-cand-01`,
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        withReport: true,
        createdAt: "2026-04-15T00:00:00.000Z",
      }),
    );

    for (const state of await resolveBoth(cwd, runId, { hasExportedCandidate: true })) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBe(getFinalistComparisonJsonPath(cwd, runId));
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
      expect(state.crowningRecordAvailable).toBe(true);
      expect(state.crowningRecordPath).toBe(getExportPlanPath(cwd, runId));
    }
  });
});
