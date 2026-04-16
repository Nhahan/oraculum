import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { getWinnerSelectionPath } from "../src/core/paths.js";
import { recommendWinnerWithJudge } from "../src/services/finalist-judge.js";
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

describe("finalist judge: winner selection", () => {
  it("falls back cleanly when the judge throws before producing a result", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_1";
    await ensureReportsDir(projectRoot, runId);

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async () => {
        throw new Error("judge binary missing");
      }),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(true);
    expect(outcome.judgeResult).toBeUndefined();
    await expect(
      readFile(`${getWinnerSelectionPath(projectRoot, runId)}.warning.txt`, "utf8"),
    ).resolves.toContain("judge binary missing");
  });

  it("ignores recommendations from a judge that did not complete successfully", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_2";
    await ensureReportsDir(projectRoot, runId);

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async () => ({
        runId,
        adapter: "codex",
        status: "failed",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-05T00:00:01.000Z",
        exitCode: 7,
        summary: "judge failed",
        recommendation: {
          decision: "select",
          candidateId: "cand-01",
          confidence: "high",
          summary: "ignore this recommendation",
        },
        artifacts: [],
      })),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(true);
    expect(outcome.judgeResult?.status).toBe("failed");
    await expect(readFile(getWinnerSelectionPath(projectRoot, runId), "utf8")).resolves.toContain(
      '"status": "failed"',
    );
    await expect(
      readFile(`${getWinnerSelectionPath(projectRoot, runId)}.warning.txt`, "utf8"),
    ).resolves.toContain('status was "failed"');
  });

  it("lets the judge abstain without forcing a fallback winner", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_3";
    await ensureReportsDir(projectRoot, runId);

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async () => ({
        runId,
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-05T00:00:00.000Z",
        completedAt: "2026-04-05T00:00:01.000Z",
        exitCode: 0,
        summary: "judge abstained",
        recommendation: {
          decision: "abstain",
          confidence: "low",
          summary: "The finalists are too weak to recommend a safe promotion.",
        },
        artifacts: [],
      })),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(false);
    expect(outcome.judgeResult?.recommendation?.decision).toBe("abstain");
    await expect(readFile(getWinnerSelectionPath(projectRoot, runId), "utf8")).resolves.toContain(
      '"decision": "abstain"',
    );
  });

  it("passes canonical validation profile fields to the judge without legacy aliases", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_4";
    await ensureReportsDir(projectRoot, runId);

    let capturedConsultationProfile:
      | Parameters<Parameters<typeof createJudgeOnlyAdapter>[1]>[0]["consultationProfile"]
      | undefined;

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async (request) => {
        capturedConsultationProfile = request.consultationProfile;
        return {
          runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "judge abstained",
          recommendation: {
            decision: "abstain",
            confidence: "low",
            summary: "Need more evidence.",
          },
          artifacts: [],
        };
      }),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      consultationProfile: {
        validationProfileId: "frontend",
        validationSummary: "Frontend validation evidence is strongest.",
        validationSignals: ["repo-local-validation", "repo-e2e-anchor"],
        validationGaps: ["No build validation command was selected."],
        confidence: "medium",
        source: "llm-recommendation",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast"],
      },
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(false);
    expect(outcome.judgeResult?.recommendation?.decision).toBe("abstain");
    expect(capturedConsultationProfile).toEqual({
      confidence: "medium",
      validationProfileId: "frontend",
      validationSummary: "Frontend validation evidence is strongest.",
      validationSignals: ["repo-local-validation", "repo-e2e-anchor"],
      validationGaps: ["No build validation command was selected."],
    });
  });
});
