import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", () => ({
  ensureProjectInitialized: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { executeRun } from "../src/services/execution.js";
import { ensureProjectInitialized } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";

const mockedPlanRun = vi.mocked(planRun);
const mockedExecuteRun = vi.mocked(executeRun);
const mockedEnsureProjectInitialized = vi.mocked(ensureProjectInitialized);

describe("run command", () => {
  beforeEach(() => {
    mockedPlanRun.mockReset();
    mockedExecuteRun.mockReset();
    mockedEnsureProjectInitialized.mockReset();
    mockedEnsureProjectInitialized.mockResolvedValue(undefined);

    const manifest = createPlannedManifest();
    mockedPlanRun.mockResolvedValue(manifest);
    mockedExecuteRun.mockResolvedValue({
      candidateResults: [
        {
          runId: manifest.id,
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 0,
          summary: "ok",
          artifacts: [],
        },
      ],
      manifest: {
        ...manifest,
        status: "completed",
        recommendedWinner: {
          candidateId: "cand-01",
          confidence: "high" as const,
          source: "llm-judge" as const,
          summary: "cand-01 is the recommended winner.",
        },
        candidates: manifest.candidates.map((candidate) => ({
          ...candidate,
          status: "promoted" as const,
        })),
      },
    });
  });

  it("executes by default after planning", async () => {
    const program = createProgram();

    await program.parseAsync(["run", "tasks/task.md"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskInput: "tasks/task.md" }),
    );
    expect(mockedExecuteRun).toHaveBeenCalledTimes(1);
  });

  it("skips execution only when plan-only is explicitly requested", async () => {
    const program = createProgram();

    await program.parseAsync(["run", "tasks/task.md", "--plan-only"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRun).not.toHaveBeenCalled();
  });

  it("auto-initializes the project before planning when needed", async () => {
    const program = createProgram();
    mockedEnsureProjectInitialized.mockResolvedValue({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.oraculum/config.json",
      createdPaths: [],
    });

    await program.parseAsync(["run", "fix session loss on refresh"], { from: "user" });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledTimes(1);
    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskInput: "fix session loss on refresh" }),
    );
  });
});

function createProgram() {
  const program = buildProgram();
  program.exitOverride();
  program.configureOutput({
    writeErr() {},
    writeOut() {},
  });
  for (const command of program.commands) {
    command.exitOverride();
    command.configureOutput({
      writeErr() {},
      writeOut() {},
    });
  }

  return program;
}

function createPlannedManifest() {
  return {
    id: "run_1",
    status: "planned" as const,
    taskPath: "/tmp/task.md",
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: "task-note" as const,
      sourcePath: "/tmp/task.md",
    },
    agent: "codex" as const,
    candidateCount: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [
      {
        id: "fast" as const,
        label: "Fast",
        status: "pending" as const,
        verdictCount: 0,
        survivorCount: 0,
        eliminatedCount: 0,
      },
      {
        id: "impact" as const,
        label: "Impact",
        status: "pending" as const,
        verdictCount: 0,
        survivorCount: 0,
        eliminatedCount: 0,
      },
      {
        id: "deep" as const,
        label: "Deep",
        status: "pending" as const,
        verdictCount: 0,
        survivorCount: 0,
        eliminatedCount: 0,
      },
    ],
    candidates: [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "planned" as const,
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
  };
}
