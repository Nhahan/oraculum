import type { Command } from "commander";
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

vi.mock("../src/services/consultations.js", () => ({
  renderConsultationSummary: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { renderConsultationSummary } from "../src/services/consultations.js";
import { executeRun } from "../src/services/execution.js";
import { ensureProjectInitialized } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedPlanRun = vi.mocked(planRun);
const mockedExecuteRun = vi.mocked(executeRun);
const mockedEnsureProjectInitialized = vi.mocked(ensureProjectInitialized);
const mockedRenderConsultationSummary = vi.mocked(renderConsultationSummary);

describe("consult command", () => {
  beforeEach(() => {
    mockedPlanRun.mockReset();
    mockedExecuteRun.mockReset();
    mockedEnsureProjectInitialized.mockReset();
    mockedRenderConsultationSummary.mockReset();
    mockedEnsureProjectInitialized.mockResolvedValue(undefined);
    mockedRenderConsultationSummary.mockResolvedValue("Consultation summary.\n");

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
          summary: "cand-01 is the recommended promotion.",
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

    await program.parseAsync(["consult", "tasks/task.md"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "tasks/task.md",
        autoProfile: { allowRuntime: true },
      }),
    );
    expect(mockedExecuteRun).toHaveBeenCalledTimes(1);
  });

  it("skips execution when draft is requested", async () => {
    const program = createProgram();

    await program.parseAsync(["draft", "tasks/task.md"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledTimes(1);
    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "tasks/task.md",
        autoProfile: { allowRuntime: false },
      }),
    );
    expect(mockedExecuteRun).not.toHaveBeenCalled();
  });

  it("auto-initializes the project before planning when needed", async () => {
    const program = createProgram();
    mockedEnsureProjectInitialized.mockResolvedValue({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.oraculum/config.json",
      createdPaths: [],
    });

    await program.parseAsync(["consult", "fix session loss on refresh"], { from: "user" });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledTimes(1);
    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "fix session loss on refresh",
        autoProfile: { allowRuntime: true },
      }),
    );
  });

  it("treats inline tasks starting with draft as normal consultations", async () => {
    const program = createProgram();

    await program.parseAsync(["consult", "draft fix session loss on refresh"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "draft fix session loss on refresh",
        autoProfile: { allowRuntime: true },
      }),
    );
    expect(mockedExecuteRun).toHaveBeenCalledTimes(1);
  });

  it("treats draft input with file-like slashes as inline task text", async () => {
    const program = createProgram();

    await program.parseAsync(["draft", "fix/session-loss-on-refresh"], { from: "user" });

    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "fix/session-loss-on-refresh",
        autoProfile: { allowRuntime: false },
      }),
    );
    expect(mockedExecuteRun).not.toHaveBeenCalled();
  });

  it("treats inline task text with file-like path fragments as normal consultations", async () => {
    const program = createProgram();

    await program.parseAsync(
      ["consult", "Update src/greet.js so greet() returns Hello instead of Bye."],
      {
        from: "user",
      },
    );

    expect(mockedPlanRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: "Update src/greet.js so greet() returns Hello instead of Bye.",
        autoProfile: { allowRuntime: true },
      }),
    );
    expect(mockedExecuteRun).toHaveBeenCalledTimes(1);
  });

  it("prints manual guidance when no recommended promotion is selected", async () => {
    const program = createProgram();
    const manifest = createPlannedManifest();
    mockedExecuteRun.mockResolvedValue({
      candidateResults: [
        {
          runId: manifest.id,
          candidateId: "cand-01",
          adapter: "codex",
          status: "failed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 1,
          summary: "candidate failed",
          artifacts: [],
        },
      ],
      manifest: {
        ...manifest,
        status: "completed",
        candidates: manifest.candidates.map((candidate) => ({
          ...candidate,
          status: "eliminated" as const,
        })),
      },
    });

    const output = await captureStdout(async () => {
      await program.parseAsync(["consult", "tasks/task.md"], { from: "user" });
    });

    expect(output).toContain("Consultation complete.");
    expect(output).toContain("Consultation summary.");
  });
});

function createProgram() {
  const program = buildProgram();
  configureCommandTree(program);

  return program;
}

function configureCommandTree(program: Command) {
  program.exitOverride();
  program.configureOutput({
    writeErr() {},
    writeOut() {},
  });
  for (const command of program.commands) {
    configureCommandTree(command);
  }
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
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
  };
}
