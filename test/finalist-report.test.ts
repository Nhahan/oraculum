import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getReportsDir,
} from "../src/core/paths.js";
import type { OracleVerdict } from "../src/domain/oracle.js";
import { writeFinalistComparisonReport } from "../src/services/finalist-report.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("finalist comparison reports", () => {
  it("writes comparison artifacts with recommendation and verdict counts", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_1"), { recursive: true });
    await mkdir(join(projectRoot, "workspace", "cand-01"), { recursive: true });
    await writeFile(
      join(projectRoot, "workspace", "cand-01", "src.ts"),
      "export const value = 1;\n",
    );

    const result = await writeFinalistComparisonReport({
      agent: "codex",
      runId: "run_1",
      taskPacket: {
        id: "task-1",
        title: "Fix session loss",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 best matches the task intent.",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace", "cand-01"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 1,
          repairedRounds: ["impact"],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "exploratory",
          strategyLabel: "Exploratory",
          status: "eliminated",
          workspaceDir: join(projectRoot, "workspace", "cand-02"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
      candidateResults: [
        {
          runId: "run_1",
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:01.000Z",
          exitCode: 0,
          summary: "Small, reviewable patch.",
          artifacts: [
            {
              kind: "patch",
              path: join(projectRoot, "patch.diff"),
            },
            {
              kind: "stdout",
              path: join(projectRoot, "stdout.log"),
            },
          ],
        },
      ],
      verdictsByCandidate: new Map<string, OracleVerdict[]>([
        [
          "cand-01",
          [
            {
              oracleId: "lint-fast",
              roundId: "fast",
              status: "pass",
              severity: "info",
              summary: "Lint passed.",
              invariant: "Code must pass lint.",
              confidence: "high",
              affectedScope: ["src/app.ts"],
              witnesses: [],
            },
            {
              oracleId: "api-impact",
              roundId: "impact",
              status: "repairable",
              severity: "warning",
              summary: "Public API drift needs review.",
              invariant: "Public API should remain stable.",
              confidence: "medium",
              affectedScope: ["src/api.ts"],
              repairHint: "Review the session restore API surface.",
              witnesses: [
                {
                  id: "witness-1",
                  kind: "command-output",
                  title: "API drift",
                  detail: "Public API drift needs review.",
                  scope: ["src/api.ts"],
                },
              ],
            },
          ],
        ],
      ]),
      projectRoot,
      verificationLevel: "standard",
    });

    expect(result.jsonPath).toBe(getFinalistComparisonJsonPath(projectRoot, "run_1"));
    expect(result.markdownPath).toBe(getFinalistComparisonMarkdownPath(projectRoot, "run_1"));

    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain('"finalistCount": 1');
    await expect(readFile(result.jsonPath, "utf8")).resolves.toContain('"warning": 1');
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "## Recommended Survivor",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Why this won: cand-01 best matches the task intent.",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "Repair attempts: 1 (impact)",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "Review the session restore API surface.",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("API drift");
  });

  it("renders an explicit no-finalists report when nobody survives", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_2"), { recursive: true });

    await writeFinalistComparisonReport({
      agent: "claude-code",
      runId: "run_2",
      taskPacket: {
        id: "task-2",
        title: "Fix auth regression",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: join(projectRoot, "workspace", "cand-01"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
      candidateResults: [],
      verdictsByCandidate: new Map(),
      projectRoot,
      verificationLevel: "none",
    });

    await expect(
      readFile(getFinalistComparisonMarkdownPath(projectRoot, "run_2"), "utf8"),
    ).resolves.toContain("No survivors cleared this run.");
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-finalist-report-"));
  tempRoots.push(path);
  return path;
}
