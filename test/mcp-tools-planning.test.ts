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
      agent: "codex",
      candidates: 2,
      timeoutMs: 1200,
    });

    expect(mockedEnsureProjectInitialized).toHaveBeenCalledWith("/tmp/project", {});
    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      agent: "codex",
      candidates: 2,
      preflight: {
        allowRuntime: true,
        timeoutMs: 1200,
      },
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
  it("parses inline host command options before planning a consultation", async () => {
    await runConsultTool({
      cwd: "/tmp/project",
      taskInput: '"tasks/fix session.md" --agent codex --candidates 3 --timeout-ms 2400',
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "tasks/fix session.md",
      agent: "codex",
      candidates: 3,
      preflight: {
        allowRuntime: true,
        timeoutMs: 2400,
      },
      autoProfile: {
        allowRuntime: true,
        timeoutMs: 2400,
      },
    });
    expect(mockedExecuteRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      runId: "run_1",
      timeoutMs: 2400,
    });
  });
  it("preserves Windows-style task paths while parsing inline consult options", async () => {
    await runConsultTool({
      cwd: "C:\\repo",
      taskInput: '"C:\\Users\\me\\task notes\\fix session.md" --agent codex --candidates 2',
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "C:\\repo",
      taskInput: "C:\\Users\\me\\task notes\\fix session.md",
      agent: "codex",
      candidates: 2,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
  });
  it("rejects incomplete inline host command options before planning", async () => {
    await expect(
      runConsultTool({
        cwd: "/tmp/project",
        taskInput: "tasks/fix.md --agent",
      }),
    ).rejects.toThrow("--agent requires a value");
    expect(mockedPlanRun).not.toHaveBeenCalled();

    await expect(
      runConsultTool({
        cwd: "/tmp/project",
        taskInput: "tasks/fix.md --candidates not-a-number",
      }),
    ).rejects.toThrow("--candidates must be an integer");
    expect(mockedPlanRun).not.toHaveBeenCalled();
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
    expect(response.mode).toBe("draft");
  });
  it("runs plan without executing candidates", async () => {
    const response = await runPlanTool({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      agent: "codex",
      candidates: 2,
      timeoutMs: 2400,
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      agent: "codex",
      candidates: 2,
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
        timeoutMs: 2400,
      },
      autoProfile: {
        allowRuntime: true,
        timeoutMs: 2400,
      },
    });
    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(response.mode).toBe("plan");
  });
  it("parses inline host command options before planning a draft", async () => {
    const response = await runDraftTool({
      cwd: "/tmp/project",
      taskInput: '"fix session loss on refresh" --agent codex --candidates 3',
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "fix session loss on refresh",
      agent: "codex",
      candidates: 3,
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(response.mode).toBe("draft");
  });
  it("preserves Windows-style task paths while parsing inline draft options", async () => {
    const response = await runDraftTool({
      cwd: "C:\\repo",
      taskInput: "C:\\Users\\me\\tasks\\fix.md --agent claude-code --candidates 1",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "C:\\repo",
      taskInput: "C:\\Users\\me\\tasks\\fix.md",
      agent: "claude-code",
      candidates: 1,
      writeConsultationPlanArtifacts: true,
      requirePlanningClarification: true,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(response.mode).toBe("draft");
  });
  it("parses plan clarification answers from inline host command options", async () => {
    await runPlanTool({
      cwd: "/tmp/project",
      taskInput:
        '"add authentication" --answer "Email/password login only; no OAuth; protect dashboard." --agent codex',
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "add authentication",
      agent: "codex",
      clarificationAnswer: "Email/password login only; no OAuth; protect dashboard.",
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
