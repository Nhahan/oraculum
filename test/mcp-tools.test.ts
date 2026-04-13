import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { runSubprocess } from "../src/core/subprocess.js";
import { summarizeSetupDiagnosticsHosts } from "../src/services/chat-native.js";
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
  runSetupStatusTool,
  runVerdictArchiveTool,
  runVerdictTool,
} from "../src/services/mcp-tools.js";
import { ensureProjectInitialized, initializeProject } from "../src/services/project.js";
import {
  planRun,
  readLatestRunManifest,
  readRunManifest,
  writeLatestRunState,
} from "../src/services/runs.js";

const mockedPlanRun = vi.mocked(planRun);
const mockedReadLatestRunManifest = vi.mocked(readLatestRunManifest);
const mockedReadRunManifest = vi.mocked(readRunManifest);
const mockedWriteLatestRunState = vi.mocked(writeLatestRunState);
const mockedExecuteRun = vi.mocked(executeRun);
const mockedEnsureProjectInitialized = vi.mocked(ensureProjectInitialized);
const mockedInitializeProject = vi.mocked(initializeProject);
const mockedListRecentConsultations = vi.mocked(listRecentConsultations);
const mockedRenderConsultationArchive = vi.mocked(renderConsultationArchive);
const mockedRenderConsultationSummary = vi.mocked(renderConsultationSummary);
const mockedMaterializeExport = vi.mocked(materializeExport);
const mockedRunSubprocess = vi.mocked(runSubprocess);
let tempRoots: string[] = [];

describe("chat-native MCP tools", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots = [];
  });

  beforeEach(() => {
    delete process.env.ORACULUM_AGENT_RUNTIME;

    mockedPlanRun.mockReset();
    mockedReadLatestRunManifest.mockReset();
    mockedReadRunManifest.mockReset();
    mockedWriteLatestRunState.mockReset();
    mockedExecuteRun.mockReset();
    mockedEnsureProjectInitialized.mockReset();
    mockedInitializeProject.mockReset();
    mockedListRecentConsultations.mockReset();
    mockedRenderConsultationArchive.mockReset();
    mockedRenderConsultationSummary.mockReset();
    mockedMaterializeExport.mockReset();
    mockedRunSubprocess.mockReset();

    mockedEnsureProjectInitialized.mockResolvedValue(undefined);
    mockedListRecentConsultations.mockResolvedValue([createCompletedManifest()]);
    mockedRenderConsultationSummary.mockResolvedValue("Consultation summary.\n");
    mockedRenderConsultationArchive.mockReturnValue("Recent consultations.\n");
    mockedPlanRun.mockResolvedValue(createPlannedManifest());
    mockedReadLatestRunManifest.mockResolvedValue(createCompletedManifest());
    mockedReadRunManifest.mockResolvedValue(createCompletedManifest());
    mockedWriteLatestRunState.mockResolvedValue(undefined);
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
    mockedRunSubprocess.mockResolvedValue(createSubprocessResult({ exitCode: 1 }));
  });

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
      recommendedCandidateId: "cand-01",
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-survivor"],
    });
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
      autoProfile: {
        allowRuntime: false,
      },
    });
    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(response.mode).toBe("draft");
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
      autoProfile: {
        allowRuntime: false,
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
      autoProfile: {
        allowRuntime: false,
      },
    });
    expect(response.mode).toBe("draft");
  });

  it("returns blocked preflight consultations without executing candidates", async () => {
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());

    const response = await runConsultTool({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
    });

    expect(mockedExecuteRun).not.toHaveBeenCalled();
    expect(mockedWriteLatestRunState).toHaveBeenCalledWith("/tmp/project", "run_blocked");
    expect(response.status).toMatchObject({
      consultationId: "run_blocked",
      outcomeType: "needs-clarification",
      terminal: true,
      preflightDecision: "needs-clarification",
      nextActions: [
        "reopen-verdict",
        "browse-archive",
        "review-preflight-readiness",
        "answer-clarification-and-rerun",
      ],
    });
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
    expect(verdict.status).toMatchObject({
      consultationId: "run_1",
      outcomeType: "recommended-survivor",
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-survivor"],
    });
    expect(archive.mode).toBe("verdict-archive");
  });

  it("filters setup-status responses to the requested host", async () => {
    const response = await runSetupStatusTool({
      cwd: process.cwd(),
      host: "codex",
    });

    expect(response.hosts).toHaveLength(1);
    expect(response.hosts[0]?.host).toBe("codex");
    expect(response.summary).toBe(
      summarizeSetupDiagnosticsHosts(
        response.hosts.map((host) => ({
          host: host.host,
          status: host.status,
          registered: host.registered,
          artifactsInstalled: host.artifactsInstalled,
        })),
      ),
    );
  });

  it("crowns through the MCP tool path", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-"));
    tempRoots.push(root);
    const patchPath = await writeExportPatch(root, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: true,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownTool({
      cwd: root,
      branchName: "fix/session-loss",
      candidateId: "cand-02",
      consultationId: "run_9",
      withReport: true,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      branchName: "fix/session-loss",
      winnerId: "cand-02",
      runId: "run_9",
      withReport: true,
    });
    expect(mockedReadRunManifest).toHaveBeenCalledWith(root, "run_1");
    expect(response.mode).toBe("crown");
    expect(response.materialization).toMatchObject({
      materialized: true,
      verified: true,
      mode: "git-branch",
      branchName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
    });
  });

  it("normalizes empty crown string inputs before materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-empty-"));
    tempRoots.push(root);
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await runCrownTool({
      cwd: root,
      branchName: "",
      materializationLabel: "   ",
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
    });
  });

  it("returns materialized branch and changed paths after crowning", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-paths-"));
    tempRoots.push(root);
    const patchPath = await writeExportPatch(root, [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownTool({
      cwd: root,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "git-branch",
      branchName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["README.md", "src/message.js"],
      changedPathCount: 2,
      checks: [
        expect.objectContaining({ id: "git-patch-artifact", status: "passed" }),
        expect.objectContaining({ id: "current-branch", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });

  it("reads git-branch changed paths from the export patch artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-patch-"));
    tempRoots.push(root);
    const patchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      patchPath,
      [
        "diff --git a/src/message.js b/src/message.js",
        "--- a/src/message.js",
        "+++ b/src/message.js",
        "@@ -1 +1 @@",
        '-export const message = "before";',
        '+export const message = "after";',
        "diff --git a/src/new-file.js b/src/new-file.js",
        "--- /dev/null",
        "+++ b/src/new-file.js",
        "@@ -0,0 +1 @@",
        "+export const added = true;",
        "",
      ].join("\n"),
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownTool({
      cwd: root,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "git-branch",
      branchName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js", "src/new-file.js"],
      changedPathCount: 2,
      checks: [
        expect.objectContaining({ id: "git-patch-artifact", status: "passed" }),
        expect.objectContaining({ id: "current-branch", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });

  it("returns verified workspace-sync materialization from the sync summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-sync-"));
    tempRoots.push(root);
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify(
        {
          appliedFiles: ["app.txt", "added.txt"],
          removedFiles: ["removed.txt"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 2,
        removedPathCount: 1,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    const response = await runCrownTool({
      cwd: root,
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
    });
    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "workspace-sync",
      changedPaths: ["added.txt", "app.txt", "removed.txt"],
      changedPathCount: 3,
      checks: [
        expect.objectContaining({ id: "workspace-sync-summary", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });

  it("reports legacy workspace-sync branch names as materialization labels", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-sync-label-"));
    tempRoots.push(root);
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "legacy-label",
        mode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    const response = await runCrownTool({
      cwd: root,
      withReport: false,
    });

    expect(response.materialization).toMatchObject({
      mode: "workspace-sync",
      materializationLabel: "legacy-label",
    });
    expect(response.materialization.branchName).toBeUndefined();
  });

  it("rejects crowning when the current branch post-check fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-branch-mismatch-"));
    tempRoots.push(root);
    const patchPath = await writeExportPatch(root, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(createSubprocessResult({ stdout: "main\n" }));

    await expect(
      runCrownTool({
        cwd: root,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('expected current git branch "fix/session-loss", received "main"');
  });

  it("rejects crowning when the git patch artifact is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-mcp-crown-missing-patch-"));
    tempRoots.push(root);
    const missingPatchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        workspaceDir: "/tmp/workspace",
        patchPath: missingPatchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await expect(
      runCrownTool({
        cwd: root,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("expected export patch does not exist");
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

function createSubprocessResult(
  overrides: Partial<Awaited<ReturnType<typeof runSubprocess>>> = {},
): Awaited<ReturnType<typeof runSubprocess>> {
  return {
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    stdout: "",
    stdoutTruncated: false,
    timedOut: false,
    ...overrides,
  };
}

async function writeExportPatch(root: string, lines: string[]): Promise<string> {
  const patchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
  await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
  await writeFile(patchPath, lines.join("\n"), "utf8");
  return patchPath;
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

function createBlockedPreflightManifest() {
  return {
    id: "run_blocked",
    status: "completed" as const,
    taskPath: "/tmp/task.md",
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: "task-note" as const,
      sourcePath: "/tmp/task.md",
    },
    agent: "codex" as const,
    configPath: "/tmp/project/.oraculum/runs/run_blocked/reports/consultation-config.json",
    candidateCount: 0,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [],
    candidates: [],
    preflight: {
      decision: "needs-clarification" as const,
      confidence: "medium" as const,
      summary: "The target file is unclear.",
      researchPosture: "repo-only" as const,
      clarificationQuestion: "Which file should Oraculum update?",
    },
    outcome: {
      type: "needs-clarification" as const,
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "unknown" as const,
      verificationLevel: "none" as const,
      missingCapabilityCount: 0,
      judgingBasisKind: "unknown" as const,
    },
  };
}
