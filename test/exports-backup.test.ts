import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/base-snapshots.js", () => ({
  assertManagedProjectSnapshotUnchanged: vi.fn(),
}));

vi.mock("../src/services/managed-tree.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/managed-tree.js")>(
    "../src/services/managed-tree.js",
  );

  return {
    ...actual,
    copyManagedProjectTree: vi.fn(async (_sourceRoot: string, destinationRoot: string) => {
      await mkdir(join(destinationRoot, "partial"), { recursive: true });
      throw new Error("copy failed");
    }),
  };
});

vi.mock("../src/services/runs.js", () => ({
  prepareExportPlan: vi.fn(),
  readRunManifest: vi.fn(),
}));

import { materializeExport } from "../src/services/exports.js";
import { prepareExportPlan, readRunManifest } from "../src/services/runs.js";

const mockedPrepareExportPlan = vi.mocked(prepareExportPlan);
const mockedReadRunManifest = vi.mocked(readRunManifest);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("workspace backup cleanup", () => {
  beforeEach(() => {
    mockedPrepareExportPlan.mockReset();
    mockedReadRunManifest.mockReset();
  });

  it("removes partial backup directories when backup creation fails", async () => {
    const cwd = await createTempRoot();
    const runId = "run_backup";
    const reportsDir = join(cwd, ".oraculum", "runs", runId, "reports");
    const workspaceDir = join(cwd, "workspace");
    await mkdir(reportsDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    mockedPrepareExportPlan.mockResolvedValue({
      path: join(reportsDir, "export-plan.json"),
      plan: {
        runId,
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir,
        withReport: false,
        createdAt: "2026-04-06T00:00:00.000Z",
      },
    });

    mockedReadRunManifest.mockResolvedValue({
      id: runId,
      status: "completed",
      taskPath: join(cwd, "tasks", "task.md"),
      taskPacket: {
        id: "task_1",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "tasks", "task.md"),
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-06T00:00:00.000Z",
      rounds: [
        {
          id: "fast",
          label: "Fast",
          status: "completed",
          verdictCount: 1,
          survivorCount: 1,
          eliminatedCount: 0,
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir,
          taskPacketPath: join(
            cwd,
            ".oraculum",
            "runs",
            runId,
            "candidates",
            "cand-01",
            "task-packet.json",
          ),
          workspaceMode: "copy",
          baseSnapshotPath: join(
            cwd,
            ".oraculum",
            "runs",
            runId,
            "candidates",
            "cand-01",
            "base-snapshot.json",
          ),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    });

    const tempBefore = await listBackupDirs(runId);

    await expect(
      materializeExport({
        cwd,
        runId,
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("copy failed");

    const tempAfter = await listBackupDirs(runId);
    expect(tempAfter).toEqual(tempBefore);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}

async function listBackupDirs(runId: string): Promise<string[]> {
  const prefix = `oraculum-export-${runId}-`;
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
}
