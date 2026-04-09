import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  prepareExportPlan: vi.fn(),
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
import * as projectService from "../src/services/project.js";
import { prepareExportPlan, readRunManifest } from "../src/services/runs.js";

const mockedRunSubprocess = vi.mocked(runSubprocess);
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

describe("git export rollback", () => {
  beforeEach(() => {
    mockedRunSubprocess.mockReset();
    mockedPrepareExportPlan.mockReset();
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

    mockedPrepareExportPlan.mockResolvedValue({
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
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    });

    let projectUntrackedCalls = 0;
    mockedRunSubprocess.mockImplementation(async (options) => {
      if (options.command !== "git") {
        throw new Error(`unexpected command: ${options.command}`);
      }

      const joinedArgs = options.args.join(" ");
      if (joinedArgs === "diff --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "diff --cached --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "rev-parse --verify --quiet refs/heads/fix/session-loss") {
        return result({ exitCode: 1 });
      }
      if (joinedArgs === "branch --show-current") {
        return result({ exitCode: 0, stdout: "main\n" });
      }
      if (joinedArgs === "rev-parse HEAD") {
        return result({ exitCode: 0, stdout: "base-revision\n" });
      }
      if (joinedArgs === "ls-files --others --exclude-standard") {
        projectUntrackedCalls += 1;
        return result({
          exitCode: 0,
          stdout:
            projectUntrackedCalls === 1
              ? ".oraculum/existing.log\n"
              : [".oraculum/existing.log", "newdir/file.txt"].join("\n"),
        });
      }
      if (joinedArgs === `-C ${workspaceDir} add -A`) {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `-C ${workspaceDir} diff --cached --name-status base-revision --`) {
        return result({ exitCode: 0, stdout: "M\tapp.txt\n" });
      }
      if (joinedArgs === `-C ${workspaceDir} ls-files --others --exclude-standard`) {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `-C ${workspaceDir} diff --cached --binary base-revision -- app.txt`) {
        return result({ exitCode: 0, stdout: "diff --git a/app.txt b/app.txt\n" });
      }
      if (joinedArgs === "checkout -b fix/session-loss") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `apply --binary ${join(reportsDir, "export.patch")}`) {
        await mkdir(transientDirectory, { recursive: true });
        await writeFile(transientFile, "temp\n", "utf8");
        return result({ exitCode: 1, stderr: "apply failed\n" });
      }
      if (joinedArgs === "reset --hard HEAD") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "checkout main") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "branch -D fix/session-loss") {
        return result({ exitCode: 0 });
      }

      throw new Error(`unexpected git invocation: ${joinedArgs}`);
    });

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('Failed to apply the crowned patch onto branch "fix/session-loss".');

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
    await expect(lstat(transientFile)).rejects.toThrow();
    await expect(lstat(transientDirectory)).rejects.toThrow();
  });

  it("rolls back a successful apply when bookkeeping fails afterward", async () => {
    const cwd = await createTempRoot();
    const runId = "run_2";
    const candidateId = "cand-01";
    const manifestPath = getRunManifestPath(cwd, runId);
    const candidateManifestPath = getCandidateManifestPath(cwd, runId, candidateId);
    const reportsDir = getReportsDir(cwd, runId);
    const workspaceDir = join(cwd, "workspace");
    const candidateDir = getCandidateDir(cwd, runId, candidateId);
    await mkdir(reportsDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(candidateDir, { recursive: true });
    await writeFile(
      join(reportsDir, "export-plan.json"),
      `${JSON.stringify({ preserved: true }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(reportsDir, "export-sync.json"),
      `${JSON.stringify({ appliedFiles: ["old.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );

    mockedPrepareExportPlan.mockResolvedValue({
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
          repairCount: 0,
          repairedRounds: [],
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
              repairCount: 0,
              repairedRounds: [],
              createdAt: "2026-04-06T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      candidateManifestPath,
      `${JSON.stringify(
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
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const originalWriteJsonFile = projectService.writeJsonFile;
    const writeJsonFileSpy = vi
      .spyOn(projectService, "writeJsonFile")
      .mockImplementation(async (path, value) => {
        if (path === candidateManifestPath) {
          throw new Error("disk full");
        }
        return originalWriteJsonFile(path, value);
      });

    let projectUntrackedCalls = 0;
    mockedRunSubprocess.mockImplementation(async (options) => {
      if (options.command !== "git") {
        throw new Error(`unexpected command: ${options.command}`);
      }

      const joinedArgs = options.args.join(" ");
      if (joinedArgs === "diff --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "diff --cached --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "rev-parse --verify --quiet refs/heads/fix/session-loss") {
        return result({ exitCode: 1 });
      }
      if (joinedArgs === "branch --show-current") {
        return result({ exitCode: 0, stdout: "main\n" });
      }
      if (joinedArgs === "rev-parse HEAD") {
        return result({ exitCode: 0, stdout: "base-revision\n" });
      }
      if (joinedArgs === "ls-files --others --exclude-standard") {
        projectUntrackedCalls += 1;
        return result({
          exitCode: 0,
          stdout: projectUntrackedCalls === 1 ? "" : ".oraculum/runs/run_2/reports/export.patch\n",
        });
      }
      if (joinedArgs === `-C ${workspaceDir} add -A`) {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `-C ${workspaceDir} diff --cached --name-status base-revision --`) {
        return result({ exitCode: 0, stdout: "M\tapp.txt\n" });
      }
      if (joinedArgs === `-C ${workspaceDir} ls-files --others --exclude-standard`) {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `-C ${workspaceDir} diff --cached --binary base-revision -- app.txt`) {
        return result({ exitCode: 0, stdout: "diff --git a/app.txt b/app.txt\n" });
      }
      if (joinedArgs === "checkout -b fix/session-loss") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === `apply --binary ${join(reportsDir, "export.patch")}`) {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "reset --hard HEAD") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "checkout main") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "branch -D fix/session-loss") {
        return result({ exitCode: 0 });
      }

      throw new Error(`unexpected git invocation: ${joinedArgs}`);
    });

    try {
      await expect(
        materializeExport({
          cwd,
          branchName: "fix/session-loss",
          withReport: false,
        }),
      ).rejects.toThrow(
        "Crowning bookkeeping failed after applying changes and the crowning was rolled back",
      );

      expect(
        mockedRunSubprocess.mock.calls.some(
          ([options]) =>
            options.command === "git" && options.args.join(" ") === "reset --hard HEAD",
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
      await expect(readFile(candidateManifestPath, "utf8")).resolves.toContain(
        '"status": "promoted"',
      );
      await expect(readFile(join(reportsDir, "export-plan.json"), "utf8")).resolves.toContain(
        '"preserved": true',
      );
      await expect(readFile(join(reportsDir, "export-sync.json"), "utf8")).resolves.toContain(
        '"old.txt"',
      );
    } finally {
      writeJsonFileSpy.mockRestore();
    }
  });

  it("fails early when the branch existence probe itself errors", async () => {
    const cwd = await createTempRoot();
    const runId = "run_3";
    const candidateId = "cand-01";
    const reportsDir = getReportsDir(cwd, runId);
    const workspaceDir = join(cwd, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    mockedPrepareExportPlan.mockResolvedValue({
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
      rounds: [],
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
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    });

    mockedRunSubprocess.mockImplementation(async (options) => {
      if (options.command !== "git") {
        throw new Error(`unexpected command: ${options.command}`);
      }

      const joinedArgs = options.args.join(" ");
      if (joinedArgs === "diff --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "diff --cached --no-ext-diff --quiet --exit-code") {
        return result({ exitCode: 0 });
      }
      if (joinedArgs === "rev-parse --verify --quiet refs/heads/fix/session-loss") {
        return result({ exitCode: 128, stderr: "fatal: not a git repository\n" });
      }

      throw new Error(`unexpected git invocation: ${joinedArgs}`);
    });

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('Failed to inspect whether branch "fix/session-loss" already exists.');
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
