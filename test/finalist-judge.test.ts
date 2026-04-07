import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import { getWinnerSelectionPath } from "../src/core/paths.js";
import { recommendWinnerWithJudge } from "../src/services/finalist-judge.js";

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

    const recommendation = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
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

    expect(recommendation).toBeUndefined();
    await expect(
      readFile(`${getWinnerSelectionPath(projectRoot, runId)}.warning.txt`, "utf8"),
    ).resolves.toContain("judge binary missing");
  });

  it("ignores recommendations from a judge that did not complete successfully", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_2";
    const reportsDir = join(projectRoot, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });

    const recommendation = await recommendWinnerWithJudge({
      adapter: {
        name: "codex",
        runCandidate: async () => {
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

    expect(recommendation).toBeUndefined();
    await expect(readFile(getWinnerSelectionPath(projectRoot, runId), "utf8")).resolves.toContain(
      '"status": "failed"',
    );
    await expect(
      readFile(`${getWinnerSelectionPath(projectRoot, runId)}.warning.txt`, "utf8"),
    ).resolves.toContain('status was "failed"');
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-finalist-judge-"));
  tempRoots.push(path);
  return path;
}
