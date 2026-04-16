import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSecondOpinionWinnerSelectionPath } from "../src/core/paths.js";
import {
  recommendSecondOpinionWithJudge,
  secondOpinionWinnerSelectionArtifactSchema,
} from "../src/services/finalist-judge.js";
import {
  createCandidateResult,
  createFinalistCandidate,
  createJudgeOnlyAdapter,
  createTaskPacket,
  createTempRoot,
  ensureReportsDir,
  registerFinalistJudgeTempRootCleanup,
} from "./helpers/finalist-judge.js";

registerFinalistJudgeTempRootCleanup();

describe("finalist judge: second opinion", () => {
  it("skips the second-opinion judge when no configured trigger matches", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_5";
    await ensureReportsDir(projectRoot, runId);

    const artifact = await recommendSecondOpinionWithJudge({
      adapter: createJudgeOnlyAdapter("claude-code", async () => {
        throw new Error("should not run");
      }),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      primaryRecommendation: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "Primary judge selected cand-01.",
        source: "llm-judge",
      },
      projectRoot,
      runId,
      secondOpinion: {
        enabled: true,
        triggers: ["judge-abstain"],
        minChangedPaths: 8,
        minChangedLines: 200,
      },
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(artifact).toBeUndefined();
    await expect(
      readFile(getSecondOpinionWinnerSelectionPath(projectRoot, runId), "utf8"),
    ).rejects.toThrow();
  });

  it("persists an advisory second-opinion artifact when the primary judge abstains", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_6";
    await ensureReportsDir(projectRoot, runId);

    const artifact = await recommendSecondOpinionWithJudge({
      adapter: createJudgeOnlyAdapter("claude-code", async () => ({
        runId,
        adapter: "claude-code",
        status: "completed",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-05T00:00:01.000Z",
        exitCode: 0,
        summary: "second opinion selected cand-02",
        recommendation: {
          decision: "select",
          candidateId: "cand-02",
          confidence: "medium",
          summary: "cand-02 is still safe enough to recommend.",
        },
        artifacts: [],
      })),
      candidateResults: [
        createCandidateResult(runId, "cand-01"),
        createCandidateResult(runId, "cand-02"),
      ],
      candidates: [
        createFinalistCandidate(projectRoot, "cand-01", {
          workspaceDir: join(projectRoot, "workspace-a"),
        }),
        createFinalistCandidate(projectRoot, "cand-02", {
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          workspaceDir: join(projectRoot, "workspace-b"),
        }),
      ],
      primaryJudgeResult: {
        runId,
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-05T00:00:01.000Z",
        exitCode: 0,
        summary: "primary judge abstained",
        recommendation: {
          decision: "abstain",
          confidence: "low",
          summary: "The finalists are too close to force a recommendation.",
        },
        artifacts: [],
      },
      projectRoot,
      runId,
      secondOpinion: {
        enabled: true,
        triggers: ["judge-abstain"],
        minChangedPaths: 8,
        minChangedLines: 200,
      },
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(artifact?.agreement).toBe("disagrees-select-vs-abstain");
    expect(artifact?.triggerKinds).toEqual(["judge-abstain"]);
    expect(artifact?.result?.recommendation?.candidateId).toBe("cand-02");
    await expect(
      readFile(getSecondOpinionWinnerSelectionPath(projectRoot, runId), "utf8"),
    ).resolves.toContain('"agreement": "disagrees-select-vs-abstain"');
  });

  it("drops failed second-opinion recommendations from the persisted advisory artifact", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_7";
    await ensureReportsDir(projectRoot, runId);

    const artifact = await recommendSecondOpinionWithJudge({
      adapter: createJudgeOnlyAdapter("claude-code", async () => ({
        runId,
        adapter: "claude-code",
        status: "failed",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-05T00:00:01.000Z",
        exitCode: 7,
        summary: "second opinion failed",
        recommendation: {
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "stale failed recommendation",
        },
        artifacts: [],
      })),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      primaryRecommendation: {
        candidateId: "cand-01",
        confidence: "low",
        summary: "Primary judge selected cand-01.",
        source: "llm-judge",
      },
      projectRoot,
      runId,
      secondOpinion: {
        enabled: true,
        triggers: ["low-confidence"],
        minChangedPaths: 8,
        minChangedLines: 200,
      },
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(artifact?.agreement).toBe("unavailable");
    expect(artifact?.result?.status).toBe("failed");
    expect(artifact?.result?.recommendation).toBeUndefined();
    await expect(
      readFile(getSecondOpinionWinnerSelectionPath(projectRoot, runId), "utf8"),
    ).resolves.not.toContain('"recommendation"');
  });

  it("rejects second-opinion artifacts whose agreement contradicts the completed recommendation", () => {
    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_1",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 stayed ahead.",
        },
        result: {
          runId: "run_schema_1",
          adapter: "claude-code",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "second opinion selected cand-02",
          recommendation: {
            decision: "select",
            candidateId: "cand-02",
            confidence: "medium",
            summary: "cand-02 is safer.",
          },
          artifacts: [],
        },
        agreement: "agrees-select",
        advisorySummary: "contradictory artifact",
      }),
    ).toThrow(/agrees-select/);

    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_2",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["judge-abstain"],
        triggerReasons: ["Primary judge abstained."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "abstain",
          confidence: "low",
          summary: "No safe winner yet.",
        },
        agreement: "agrees-abstain",
        advisorySummary: "contradictory artifact",
      }),
    ).toThrow(/result is required/);

    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_3",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 stayed ahead.",
        },
        result: {
          runId: "run_schema_other",
          adapter: "codex",
          status: "failed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 1,
          summary: "second opinion failed",
          artifacts: [],
        },
        agreement: "unavailable",
        advisorySummary: "mismatched unavailable artifact",
      }),
    ).toThrow(/result\.(runId|adapter) must match/i);

    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_4",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence", "fallback-policy"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "fallback-policy",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 stayed ahead.",
        },
        result: {
          runId: "run_schema_4",
          adapter: "claude-code",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "second opinion selected cand-01",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "medium",
            summary: "cand-01 is still safest.",
          },
          artifacts: [],
        },
        agreement: "agrees-select",
        advisorySummary: "length-mismatched trigger artifact",
      }),
    ).toThrow(/triggerReasons must align 1:1 with triggerKinds/i);

    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_5",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 stayed ahead.",
        },
        result: {
          runId: "run_schema_5",
          adapter: "claude-code",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "second opinion returned no recommendation",
          artifacts: [],
        },
        agreement: "unavailable",
        advisorySummary: "completed unavailable artifact",
      }),
    ).toThrow(/cannot be completed when second-opinion agreement is unavailable/i);

    expect(() =>
      secondOpinionWinnerSelectionArtifactSchema.parse({
        runId: "run_schema_6",
        advisoryOnly: true,
        adapter: "claude-code",
        triggerKinds: ["low-confidence"],
        triggerReasons: ["Primary judge confidence was low."],
        primaryRecommendation: {
          source: "llm-judge",
          decision: "select",
          candidateId: "cand-01",
          confidence: "low",
          summary: "cand-01 stayed ahead.",
        },
        result: {
          runId: "run_schema_6",
          adapter: "claude-code",
          status: "failed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 1,
          summary: "second opinion failed after producing stale payload",
          recommendation: {
            decision: "select",
            candidateId: "cand-02",
            confidence: "medium",
            summary: "stale recommendation should be rejected",
          },
          artifacts: [],
        },
        agreement: "unavailable",
        advisorySummary: "failed unavailable artifact with stale recommendation",
      }),
    ).toThrow(/result\.recommendation must be omitted/i);
  });
});
