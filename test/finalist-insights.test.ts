import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentRunResult } from "../src/adapters/types.js";
import type { OracleVerdict } from "../src/domain/oracle.js";
import type { CandidateManifest } from "../src/domain/run.js";
import { captureManagedProjectSnapshot } from "../src/services/base-snapshots.js";
import { buildEnrichedFinalistSummaries } from "../src/services/finalist-insights.js";
import { writeJsonFile } from "../src/services/project.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("finalist insights", () => {
  it("enriches promoted finalists with change summaries, witness rollups, and repair detail", async () => {
    const root = await createTempRoot();
    const baselineDir = join(root, "baseline");
    const workspaceDir = join(root, "workspace");
    await mkdir(baselineDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    await writeFile(join(baselineDir, "src.ts"), "export const version = 1;\n", "utf8");
    await writeFile(join(workspaceDir, "src.ts"), "export const version = 2;\n", "utf8");
    await writeFile(join(workspaceDir, "new.txt"), "new file\n", "utf8");

    const snapshotPath = join(root, "base-snapshot.json");
    await writeJsonFile(snapshotPath, await captureManagedProjectSnapshot(baselineDir));

    const candidates: CandidateManifest[] = [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "promoted",
        workspaceDir,
        taskPacketPath: join(root, "task-packet.json"),
        workspaceMode: "copy",
        baseSnapshotPath: snapshotPath,
        repairCount: 1,
        repairedRounds: ["impact"],
        createdAt: "2026-04-07T00:00:00.000Z",
      },
    ];

    const candidateResults: AgentRunResult[] = [
      {
        runId: "run_1",
        candidateId: "cand-01",
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-07T00:00:00.000Z",
        completedAt: "2026-04-07T00:00:01.000Z",
        exitCode: 0,
        summary: "Updated the session flow and left reviewable evidence.",
        artifacts: [{ kind: "patch", path: join(root, "patch.diff") }],
      },
    ];

    const verdictsByCandidate = new Map<string, OracleVerdict[]>([
      [
        "cand-01",
        [
          {
            oracleId: "reviewable-output",
            roundId: "impact",
            status: "repairable",
            severity: "warning",
            summary: "Reviewable output improved after repair.",
            invariant: "Candidates should leave reviewable output for comparison.",
            confidence: "medium",
            affectedScope: ["src.ts"],
            repairHint: "Persist a richer transcript or patch summary.",
            witnesses: [
              {
                id: "w-1",
                kind: "file",
                title: "Reviewable output",
                detail: "A patch artifact was captured after the repair attempt.",
                scope: ["src.ts"],
              },
            ],
          },
        ],
      ],
    ]);

    const finalists = await buildEnrichedFinalistSummaries({
      candidates,
      candidateResults,
      verdictsByCandidate,
    });

    expect(finalists).toHaveLength(1);
    expect(finalists[0]?.changedPaths).toEqual(["new.txt", "src.ts"]);
    expect(finalists[0]?.changeSummary.mode).toBe("snapshot-diff");
    expect(finalists[0]?.changeSummary.changedPathCount).toBe(2);
    expect(finalists[0]?.witnessRollup.repairHints).toEqual([
      "Persist a richer transcript or patch summary.",
    ]);
    expect(finalists[0]?.witnessRollup.keyWitnesses[0]?.title).toBe("Reviewable output");
    expect(finalists[0]?.repairSummary.attemptCount).toBe(1);
    expect(finalists[0]?.repairSummary.repairedRounds).toEqual(["impact"]);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-finalist-insights-"));
  tempRoots.push(path);
  return path;
}
