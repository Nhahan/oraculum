import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import { getSecondOpinionWinnerSelectionPath, getWinnerSelectionPath } from "../src/core/paths.js";
import {
  recommendSecondOpinionWithJudge,
  recommendWinnerWithJudge,
} from "../src/services/finalist-judge.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("finalist judge", () => {
  it("falls back cleanly when the judge throws before producing a result", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_1";
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const outcome = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async () => {
          throw new Error("judge binary missing");
        },
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      projectRoot,
      runId,
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
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
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const outcome = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async () => ({
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
        }),
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      projectRoot,
      runId,
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
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
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const outcome = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async () => ({
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
        }),
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      projectRoot,
      runId,
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
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
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    let capturedConsultationProfile:
      | Parameters<AgentAdapter["recommendWinner"]>[0]["consultationProfile"]
      | undefined;

    const outcome = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async (request) => {
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
        },
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
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
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
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

  it("skips the second-opinion judge when no configured trigger matches", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_5";
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const artifact = await recommendSecondOpinionWithJudge({
      adapter: {
        name: "claude-code",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async () => {
          throw new Error("should not run");
        },
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
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
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
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
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const artifact = await recommendSecondOpinionWithJudge({
      adapter: {
        name: "claude-code",
        runCandidate: async () => {
          throw new Error("not used");
        },
        recommendPreflight: async () => {
          throw new Error("not used");
        },
        recommendProfile: async () => {
          throw new Error("not used");
        },
        recommendWinner: async () => ({
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
        }),
      } satisfies AgentAdapter,
      candidateResults: [
        {
          runId,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
        {
          runId,
          candidateId: "cand-02",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace-a"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace-b"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
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
      taskPacket: {
        id: "task",
        title: "Task",
        intent: "Fix the bug.",
        source: {
          kind: "task-note",
          path: join(projectRoot, "task.md"),
        },
      },
      verdictsByCandidate: new Map(),
    });

    expect(artifact?.agreement).toBe("disagrees-select-vs-abstain");
    expect(artifact?.triggerKinds).toEqual(["judge-abstain"]);
    expect(artifact?.result?.recommendation?.candidateId).toBe("cand-02");
    await expect(
      readFile(getSecondOpinionWinnerSelectionPath(projectRoot, runId), "utf8"),
    ).resolves.toContain('"agreement": "disagrees-select-vs-abstain"');
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-finalist-judge-"));
  tempRoots.push(path);
  return path;
}
