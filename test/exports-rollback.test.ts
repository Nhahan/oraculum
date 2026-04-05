import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  buildExportPlan: vi.fn(),
  readRunManifest: vi.fn(),
}));

import {
  getCandidateDir,
  getCandidateManifestPath,
  getReportsDir,
  getRunManifestPath,
} from "../src/core/paths.js";
import { runSubprocess } from "../src/core/subprocess.js";
import { runManifestSchema } from "../src/domain/run.js";
import { materializeExport } from "../src/services/exports.js";
import { buildExportPlan, readRunManifest } from "../src/services/runs.js";

const mockedRunSubprocess = vi.mocked(runSubprocess);
const mockedBuildExportPlan = vi.mocked(buildExportPlan);
const mockedReadRunManifest = vi.mocked(readRunManifest);

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("git export rollback", () => {
  beforeEach(() => {
    mockedRunSubprocess.mockReset();
    mockedBuildExportPlan.mockReset();
    mockedReadRunManifest.mockReset();
  });

  it("rolls back after a post-checkout git apply failure", async () => {
    const cwd = await createTempRoot();
    const runId = "run_1";
    const candidateId = "cand-01";
    const candidateDir = getCandidateDir(cwd, runId, candidateId);
    const reportsDir = getReportsDir(cwd, runId);
    const workspaceDir = join(cwd, "workspace");
    const transientDirectory = join(cwd, "newdir");
    const transientFile = join(transientDirectory, "file.txt");
    await mkdir(candidateDir, { recursive: true });
    await mkdir(reportsDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(transientDirectory, { recursive: true });
    await writeFile(transientFile, "temp\n", "utf8");

    mockedBuildExportPlan.mockResolvedValue({
      path: join(reportsDir, "export-plan.json"),
      plan: {
        runId,
        winnerId: candidateId,
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir,
        patchPath: join(reportsDir, "export.patch"),
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
        candidateId,
        confidence: "high",
        summary: "cand-01 is the recommended winner.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: candidateId,
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir,
          taskPacketPath: join(candidateDir, "task-packet.json"),
          workspaceMode: "git-worktree",
          baseRevision: "base-revision",
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    });

    mockedRunSubprocess
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 1 }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "main\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "base-revision\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: ".oraculum/existing.log\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "diff --git a/app.txt b/app.txt\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 1, stderr: "apply failed\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(
        result({
          exitCode: 0,
          stdout: [".oraculum/existing.log", "newdir/file.txt"].join("\n"),
        }),
      )
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }));

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('Failed to apply exported patch onto branch "fix/session-loss".');

    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) => options.command === "git" && options.args.join(" ") === "reset --hard HEAD",
      ),
    ).toBe(true);
    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) =>
          options.command === "git" &&
          options.args.join(" ") === "ls-files --others --exclude-standard",
      ),
    ).toBe(true);
    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) => options.command === "git" && options.args.join(" ") === "checkout main",
      ),
    ).toBe(true);
    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) =>
          options.command === "git" && options.args.join(" ") === "branch -D fix/session-loss",
      ),
    ).toBe(true);
    await expect(readFile(transientFile, "utf8")).rejects.toThrow();
    await expect(readFile(transientDirectory, "utf8")).rejects.toThrow();
  });

  it("rolls back a successful apply when bookkeeping fails afterward", async () => {
    const cwd = await createTempRoot();
    const runId = "run_2";
    const candidateId = "cand-01";
    const manifestPath = getRunManifestPath(cwd, runId);
    const candidateManifestPath = getCandidateManifestPath(cwd, runId, candidateId);
    const reportsDir = getReportsDir(cwd, runId);
    const workspaceDir = join(cwd, "workspace");
    await mkdir(reportsDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    mockedBuildExportPlan.mockResolvedValue({
      path: join(reportsDir, "export-plan.json"),
      plan: {
        runId,
        winnerId: candidateId,
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir,
        patchPath: join(reportsDir, "export.patch"),
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
        candidateId,
        confidence: "high",
        summary: "cand-01 is the recommended winner.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: candidateId,
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
            candidateId,
            "task-packet.json",
          ),
          workspaceMode: "git-worktree",
          baseRevision: "base-revision",
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    });
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
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
            candidateId,
            confidence: "high",
            summary: "cand-01 is the recommended winner.",
            source: "llm-judge",
          },
          candidates: [
            {
              id: candidateId,
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
                candidateId,
                "task-packet.json",
              ),
              workspaceMode: "git-worktree",
              baseRevision: "base-revision",
              createdAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    mockedRunSubprocess
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 1 }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "main\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "base-revision\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0, stdout: "diff --git a/app.txt b/app.txt\n" }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(
        result({ exitCode: 0, stdout: ".oraculum/runs/run_2/reports/export.patch\n" }),
      )
      .mockResolvedValueOnce(result({ exitCode: 0 }))
      .mockResolvedValueOnce(result({ exitCode: 0 }));

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow(
      "Export bookkeeping failed after applying changes and the export was rolled back",
    );

    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) => options.command === "git" && options.args.join(" ") === "reset --hard HEAD",
      ),
    ).toBe(true);
    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) =>
          options.command === "git" &&
          options.args.join(" ") === "ls-files --others --exclude-standard",
      ),
    ).toBe(true);
    expect(
      mockedRunSubprocess.mock.calls.some(
        ([options]) =>
          options.command === "git" && options.args.join(" ") === "branch -D fix/session-loss",
      ),
    ).toBe(true);

    const restoredManifest = runManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    );
    expect(restoredManifest.candidates[0]?.status).toBe("promoted");
    await expect(readFile(candidateManifestPath, "utf8")).rejects.toThrow();
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}

function result(input: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): Awaited<ReturnType<typeof runSubprocess>> {
  return {
    durationMs: 1,
    exitCode: input.exitCode,
    signal: null,
    stderr: input.stderr ?? "",
    stdout: input.stdout ?? "",
    timedOut: false,
  };
}
