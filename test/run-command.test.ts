import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { executeRun } from "../src/services/execution.js";
import { planRun } from "../src/services/runs.js";

const mockedPlanRun = vi.mocked(planRun);
const mockedExecuteRun = vi.mocked(executeRun);

describe("run command", () => {
  beforeEach(() => {
    mockedPlanRun.mockReset();
    mockedExecuteRun.mockReset();

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
        candidates: manifest.candidates.map((candidate) => ({
          ...candidate,
          status: "promoted" as const,
        })),
      },
    });
  });

  it("executes by default after planning", async () => {
    const program = createProgram();

    await program.parseAsync(["run", "--task", "tasks/task.md"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRun).toHaveBeenCalledTimes(1);
  });

  it("skips execution only when plan-only is explicitly requested", async () => {
    const program = createProgram();

    await program.parseAsync(["run", "--task", "tasks/task.md", "--plan-only"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedExecuteRun).not.toHaveBeenCalled();
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
