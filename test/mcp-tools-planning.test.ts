import { describe, expect, it, vi } from "vitest";

import type { ConsultProgressEvent } from "../src/services/consult-progress.js";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
  writeLatestRunState: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/project.js")>(
    "../src/services/project.js",
  );

  return {
    ...actual,
    ensureProjectInitialized: vi.fn(),
    hasNonEmptyTextArtifact: vi.fn(() => false),
    hasNonEmptyTextArtifactSync: vi.fn(() => false),
    initializeProject: vi.fn(),
  };
});

vi.mock("../src/services/consultations.js", () => ({
  buildVerdictReview: vi.fn(),
  isInvalidConsultationRecord: vi.fn(),
  listRecentConsultationRecords: vi.fn(),
  listRecentConsultations: vi.fn(),
  renderConsultationArchive: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import { runConsultTool, runDraftTool, runPlanTool } from "../src/services/mcp-tools.js";
import {
  createBlockedPreflightManifest,
  createCompletedManifest,
  mockedEnsureProjectInitialized,
  mockedExecuteRun,
  mockedPlanRun,
  mockedRenderConsultationSummary,
  mockedWriteLatestRunState,
  registerMcpToolsTestHarness,
} from "./helpers/mcp-tools.js";

registerMcpToolsTestHarness();

describe("chat-native MCP tools: planning", () => {
  it("runs consult through the shared MCP tool path", async () => {
    const response = await runConsultTool({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
    });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledWith("/tmp/project", {});
    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(mockedExecuteRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      runId: "run_1",
    });
    expect(mockedRenderConsultationSummary).toHaveBeenCalledWith(
      createCompletedManifest(),
      "/tmp/project",
      expect.objectContaining({ surface: "chat-native" }),
    );
    expect(response.mode).toBe("consult");
    expect(response.status).toMatchObject({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchRerunRecommended: false,
      recommendedCandidateId: "cand-01",
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-result"],
    });
  });
  it("emits consult progress updates in execution order", async () => {
    const progress: ConsultProgressEvent[] = [];
    mockedExecuteRun.mockImplementationOnce(async (options) => {
      await options.onProgress?.({
        kind: "candidate-running",
        phase: "execution",
        candidateId: "cand-01",
        candidateIndex: 1,
        candidateCount: 1,
        message: "Candidate 1/1 (cand-01) running",
      });
      await options.onProgress?.({
        kind: "comparing-finalists",
        phase: "judging",
        finalistCount: 1,
        message: "Comparing 1 surviving candidate",
      });
      await options.onProgress?.({
        kind: "verdict-ready",
        phase: "completed",
        message: "Verdict ready",
      });
      return {
        candidateResults: [],
        manifest: createCompletedManifest(),
      };
    });

    await runConsultTool(
      {
        cwd: "/tmp/project",
        taskInput: "tasks/task.md",
      },
      {
        onProgress: (message) => {
          progress.push(message);
        },
      },
    );

    expect(progress.map((event) => event.kind)).toEqual([
      "consultation-started",
      "planning-started",
      "candidate-running",
      "comparing-finalists",
      "verdict-ready",
    ]);
    expect(progress.map((event) => event.message)).toEqual([
      "Starting consultation",
      "Planning consultation",
      "Candidate 1/1 (cand-01) running",
      "Comparing 1 surviving candidate",
      "Verdict ready",
    ]);
  });
  it("uses the host runtime as the auto-init quick-start default", async () => {
    process.env.ORACULUM_AGENT_RUNTIME = "codex";

    await runConsultTool({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
    });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledWith("/tmp/project", {
      defaultAgent: "codex",
    });
    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
  });
  it("preserves removed flag names when they are part of task text", async () => {
    await runPlanTool({
      cwd: "/tmp/project",
      taskInput: "remove the old --agent and --answer docs",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "remove the old --agent and --answer docs",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
  });
  it("rejects removed public planning request fields at the schema boundary", async () => {
    await expect(
      runConsultTool({
        cwd: "/tmp/project",
        taskInput: "tasks/task.md",
        agent: "codex",
      } as Parameters<typeof runConsultTool>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedPlanRun).not.toHaveBeenCalled();

    await expect(
      runPlanTool({
        cwd: "/tmp/project",
        taskInput: "fix login",
        candidates: 2,
        deliberate: true,
        timeoutMs: 1200,
      } as Parameters<typeof runPlanTool>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedPlanRun).not.toHaveBeenCalled();
  });
  it("runs draft without executing candidates", async () => {
    const response = await runDraftTool({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(mockedWriteLatestRunState).toHaveBeenCalledWith("/tmp/project", "run_1");
    expect(response.mode).toBe("draft");
  });
  it("runs plan without executing candidates", async () => {
    const response = await runPlanTool({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(mockedWriteLatestRunState).toHaveBeenCalledWith("/tmp/project", "run_1");
    expect(response.mode).toBe("plan");
  });
  it("returns blocked preflight consultations without executing candidates", async () => {
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());
    const progress: ConsultProgressEvent[] = [];

    const response = await runConsultTool(
      {
        cwd: "/tmp/project",
        taskInput: "tasks/task.md",
      },
      {
        onProgress: (message) => {
          progress.push(message);
        },
      },
    );

    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(mockedWriteLatestRunState).toHaveBeenCalledWith("/tmp/project", "run_blocked");
    expect(progress.map((event) => event.kind)).toEqual([
      "consultation-started",
      "planning-started",
      "preflight-blocked",
    ]);
    expect(progress.map((event) => event.message)).toEqual([
      "Starting consultation",
      "Planning consultation",
      "Preflight blocked: needs-clarification",
    ]);
    expect(response.status).toMatchObject({
      consultationId: "run_blocked",
      outcomeType: "needs-clarification",
      terminal: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      preflightDecision: "needs-clarification",
      nextActions: [
        "reopen-verdict",
        "browse-archive",
        "review-preflight-readiness",
        "answer-clarification-and-rerun",
      ],
    });
  });
});
