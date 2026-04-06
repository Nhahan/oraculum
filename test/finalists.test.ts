import { describe, expect, it } from "vitest";

import type { AgentRunResult } from "../src/adapters/types.js";
import type { OracleVerdict } from "../src/domain/oracle.js";
import type { CandidateManifest } from "../src/domain/run.js";
import { buildFinalistSummaries } from "../src/services/finalists.js";

describe("finalist summaries", () => {
  it("includes only promoted candidates and carries verdict and artifact detail", () => {
    const candidates: CandidateManifest[] = [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "promoted",
        workspaceDir: "/tmp/cand-01",
        taskPacketPath: "/tmp/cand-01/task-packet.json",
        createdAt: "2026-04-06T00:00:00.000Z",
      },
      {
        id: "cand-02",
        strategyId: "exploratory",
        strategyLabel: "Exploratory",
        status: "eliminated",
        workspaceDir: "/tmp/cand-02",
        taskPacketPath: "/tmp/cand-02/task-packet.json",
        createdAt: "2026-04-06T00:00:00.000Z",
      },
    ];

    const candidateResults: AgentRunResult[] = [
      {
        runId: "run_1",
        candidateId: "cand-01",
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-06T00:00:00.000Z",
        completedAt: "2026-04-06T00:00:01.000Z",
        exitCode: 0,
        summary: "Candidate completed successfully.",
        artifacts: [
          {
            kind: "patch",
            path: "/tmp/cand-01/patch.diff",
          },
          {
            kind: "stdout",
            path: "/tmp/cand-01/stdout.log",
          },
        ],
      },
    ];

    const verdictsByCandidate = new Map<string, OracleVerdict[]>([
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
        ],
      ],
    ]);

    expect(buildFinalistSummaries(candidates, candidateResults, verdictsByCandidate)).toEqual([
      {
        candidateId: "cand-01",
        strategyLabel: "Minimal Change",
        summary: "Candidate completed successfully.",
        artifactKinds: ["patch", "stdout"],
        verdicts: [
          {
            roundId: "fast",
            oracleId: "lint-fast",
            status: "pass",
            severity: "info",
            summary: "Lint passed.",
          },
        ],
      },
    ]);
  });

  it("falls back when a promoted candidate has no captured run result", () => {
    const candidates: CandidateManifest[] = [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "promoted",
        workspaceDir: "/tmp/cand-01",
        taskPacketPath: "/tmp/cand-01/task-packet.json",
        createdAt: "2026-04-06T00:00:00.000Z",
      },
    ];

    const summaries = buildFinalistSummaries(candidates, [], new Map());

    expect(summaries).toEqual([
      {
        candidateId: "cand-01",
        strategyLabel: "Minimal Change",
        summary: "No agent summary captured.",
        artifactKinds: [],
        verdicts: [],
      },
    ]);
  });
});
