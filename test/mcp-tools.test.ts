import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", () => ({
  ensureProjectInitialized: vi.fn(),
  initializeProject: vi.fn(),
}));

vi.mock("../src/services/consultations.js", () => ({
  listRecentConsultations: vi.fn(),
  renderConsultationArchive: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import {
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import { executeRun } from "../src/services/execution.js";
import { materializeExport } from "../src/services/exports.js";
import {
  runConsultTool,
  runCrownTool,
  runDraftTool,
  runInitTool,
  runVerdictArchiveTool,
  runVerdictTool,
} from "../src/services/mcp-tools.js";
import { ensureProjectInitialized, initializeProject } from "../src/services/project.js";
import { planRun, readLatestRunManifest, readRunManifest } from "../src/services/runs.js";

const mockedPlanRun = vi.mocked(planRun);
const mockedReadLatestRunManifest = vi.mocked(readLatestRunManifest);
const mockedReadRunManifest = vi.mocked(readRunManifest);
const mockedExecuteRun = vi.mocked(executeRun);
const mockedEnsureProjectInitialized = vi.mocked(ensureProjectInitialized);
const mockedInitializeProject = vi.mocked(initializeProject);
const mockedListRecentConsultations = vi.mocked(listRecentConsultations);
const mockedRenderConsultationArchive = vi.mocked(renderConsultationArchive);
const mockedRenderConsultationSummary = vi.mocked(renderConsultationSummary);
const mockedMaterializeExport = vi.mocked(materializeExport);

describe("chat-native MCP tools", () => {
  beforeEach(() => {
    mockedPlanRun.mockReset();
    mockedReadLatestRunManifest.mockReset();
    mockedReadRunManifest.mockReset();
    mockedExecuteRun.mockReset();
    mockedEnsureProjectInitialized.mockReset();
    mockedInitializeProject.mockReset();
    mockedListRecentConsultations.mockReset();
    mockedRenderConsultationArchive.mockReset();
    mockedRenderConsultationSummary.mockReset();
    mockedMaterializeExport.mockReset();

    mockedEnsureProjectInitialized.mockResolvedValue(undefined);
    mockedListRecentConsultations.mockResolvedValue([createCompletedManifest()]);
    mockedRenderConsultationSummary.mockResolvedValue("Consultation summary.\n");
    mockedRenderConsultationArchive.mockReturnValue("Recent consultations.\n");
    mockedPlanRun.mockResolvedValue(createPlannedManifest());
    mockedReadLatestRunManifest.mockResolvedValue(createCompletedManifest());
    mockedReadRunManifest.mockResolvedValue(createCompletedManifest());
    mockedExecuteRun.mockResolvedValue({
      candidateResults: [],
      manifest: createCompletedManifest(),
    });
    mockedInitializeProject.mockResolvedValue({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.oraculum/config.json",
      createdPaths: ["/tmp/project/.oraculum"],
    });
    mockedMaterializeExport.mockResolvedValue({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: "/tmp/export-plan.json",
    });
  });

  it("runs consult through the shared MCP tool path", async () => {
    const response = await runConsultTool({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      agent: "codex",
      candidates: 2,
      timeoutMs: 1200,
    });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledWith("/tmp/project");
    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      agent: "codex",
      candidates: 2,
      autoProfile: {
        allowRuntime: true,
        timeoutMs: 1200,
      },
    });
    expect(mockedExecuteRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      runId: "run_1",
      timeoutMs: 1200,
    });
    expect(mockedRenderConsultationSummary).toHaveBeenCalledWith(
      createCompletedManifest(),
      "/tmp/project",
      { surface: "chat-native" },
    );
    expect(response.mode).toBe("consult");
  });

  it("runs draft without executing candidates", async () => {
    const response = await runDraftTool({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      agent: "claude-code",
      candidates: 1,
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      agent: "claude-code",
      candidates: 1,
      autoProfile: {
        allowRuntime: false,
      },
    });
    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(response.mode).toBe("draft");
  });

  it("reopens verdicts and archives through MCP tools", async () => {
    const verdict = await runVerdictTool({
      cwd: "/tmp/project",
      consultationId: "run_9",
    });
    const archive = await runVerdictArchiveTool({
      cwd: "/tmp/project",
      count: 5,
    });

    expect(mockedReadRunManifest).toHaveBeenCalledWith("/tmp/project", "run_9");
    expect(mockedListRecentConsultations).toHaveBeenCalledWith("/tmp/project", 5);
    expect(verdict.mode).toBe("verdict");
    expect(archive.mode).toBe("verdict-archive");
  });

  it("crowns through the MCP tool path", async () => {
    const response = await runCrownTool({
      cwd: "/tmp/project",
      branchName: "fix/session-loss",
      candidateId: "cand-02",
      consultationId: "run_9",
      withReport: true,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      branchName: "fix/session-loss",
      winnerId: "cand-02",
      runId: "run_9",
      withReport: true,
    });
    expect(mockedReadRunManifest).toHaveBeenCalledWith("/tmp/project", "run_1");
    expect(response.mode).toBe("crown");
  });

  it("initializes projects through the MCP tool path", async () => {
    const response = await runInitTool({
      cwd: "/tmp/project",
      force: true,
    });

    expect(mockedInitializeProject).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      force: true,
    });
    expect(response.mode).toBe("init");
    expect(response.initialization.projectRoot).toBe("/tmp/project");
  });
});

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
    configPath: "/tmp/project/.oraculum/runs/run_1/reports/consultation-config.json",
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

function createCompletedManifest() {
  return {
    ...createPlannedManifest(),
    status: "completed" as const,
    recommendedWinner: {
      candidateId: "cand-01",
      confidence: "high" as const,
      source: "llm-judge" as const,
      summary: "cand-01 is the recommended survivor.",
    },
    candidates: [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: "promoted" as const,
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
  };
}
