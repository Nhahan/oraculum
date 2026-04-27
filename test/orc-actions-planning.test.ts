import { describe, expect, it, vi } from "vitest";
import {
  getConsultationPlanPath,
  getConsultationPlanReadinessPath,
  getExportPlanPath,
  getExportSyncSummaryPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { consultActionRequestSchema } from "../src/domain/chat-native.js";
import {
  consultationPlanArtifactSchema,
  consultationPlanReadinessSchema,
  type RunManifest,
  runManifestSchema,
} from "../src/domain/run.js";
import type { ConsultProgressEvent } from "../src/services/consult-progress.js";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  answerPlanRun: vi.fn(),
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
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import {
  runConsultAction,
  runPlanAction,
  runUserInteractionAnswerAction,
} from "../src/services/orc-actions.js";
import {
  createBlockedPreflightManifest,
  createCandidate,
  createCompletedManifest,
  createFinalistsWithoutRecommendationManifest,
  createOrcActionTempRoot,
  createSubprocessResult,
  mockedAnswerPlanRun,
  mockedEnsureProjectInitialized,
  mockedExecuteRun,
  mockedMaterializeExport,
  mockedPlanRun,
  mockedReadRunManifest,
  mockedRenderConsultationSummary,
  mockedRunSubprocess,
  mockedWriteLatestRunState,
  registerOrcActionsTestHarness,
  writeDisagreeingSecondOpinionSelection,
  writeExportPatch,
  writeExportPlanArtifact,
  writeJsonArtifact,
} from "./helpers/orc-actions.js";
import {
  createRunCandidateFixture,
  createRunManifestFixture,
  createRunRoundFixture,
  createTaskPacketFixture,
} from "./helpers/run-manifest.js";

registerOrcActionsTestHarness();

describe("chat-native Orc actions: planning", () => {
  it("runs consult through the shared Orc action path", async () => {
    const response = await runConsultAction({
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
      nextActions: ["reopen-verdict", "crown-recommended-result"],
    });
  });
  it("accepts deferApply at the consult action schema boundary", () => {
    expect(
      consultActionRequestSchema.parse({
        cwd: "/tmp/project",
        taskInput: "tasks/task.md",
        deferApply: true,
      }),
    ).toMatchObject({
      deferApply: true,
    });
  });
  it("returns apply approval for an eligible workspace-sync winner", async () => {
    mockedExecuteRun.mockResolvedValueOnce({
      candidateResults: [],
      manifest: createCompletedManifestWithWorkspaceMode("copy"),
    });

    const response = await runConsultAction({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
    });

    expect(response.userInteraction).toEqual({
      kind: "apply-approval",
      runId: "run_1",
      header: "Apply recommended result",
      question: "Apply recommended candidate cand-01 to this workspace?",
      expectedAnswerShape:
        "Choose Apply, choose Do not apply, or enter an optional materialization label to apply with that label.",
      options: [
        {
          label: "Apply",
          description: "Materialize the recommended result in the project workspace.",
        },
        {
          label: "Do not apply",
          description: "Keep the verdict only and leave the project workspace unchanged.",
        },
      ],
      freeTextAllowed: true,
    });
  });
  it("returns direct apply approval for an eligible git winner", async () => {
    mockedExecuteRun.mockResolvedValueOnce({
      candidateResults: [],
      manifest: createCompletedManifestWithWorkspaceMode("git-worktree"),
    });

    const response = await runConsultAction({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
    });

    expect(response.userInteraction).toEqual({
      kind: "apply-approval",
      runId: "run_1",
      header: "Apply recommended result",
      question: "Apply recommended candidate cand-01 to this workspace?",
      expectedAnswerShape:
        "Choose Apply, choose Do not apply, or enter an optional materialization label to apply with that label.",
      options: [
        {
          label: "Apply",
          description: "Materialize the recommended result in the project workspace.",
        },
        {
          label: "Do not apply",
          description: "Keep the verdict only and leave the project workspace unchanged.",
        },
      ],
      freeTextAllowed: true,
    });
  });
  it("defers apply approval when consult deferApply is set", async () => {
    mockedExecuteRun.mockResolvedValueOnce({
      candidateResults: [],
      manifest: createCompletedManifestWithWorkspaceMode("copy"),
    });

    const response = await runConsultAction({
      cwd: "/tmp/project",
      taskInput: "tasks/task.md",
      deferApply: true,
    });

    expect(response.userInteraction).toBeUndefined();
  });
  it("omits apply approval when safety blockers require manual crown review", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-apply-blockers-");

    const blockedManifests = [
      createCompletedManifestWithWorkspaceMode("copy", {
        outcome: {
          validationGapCount: 1,
          validationPosture: "validation-gaps",
        },
        profileSelection: {
          validationGaps: ["Missing full-suite evidence."],
        },
      }),
      createCompletedManifestWithWorkspaceMode("copy", {
        recommendedWinner: {
          source: "fallback-policy",
        },
      }),
    ];

    for (const manifest of blockedManifests) {
      mockedExecuteRun.mockResolvedValueOnce({
        candidateResults: [],
        manifest,
      });

      const response = await runConsultAction({
        cwd,
        taskInput: "tasks/task.md",
      });

      expect(response.userInteraction).toBeUndefined();
    }

    await writeDisagreeingSecondOpinionSelection(cwd, "run_1");
    mockedExecuteRun.mockResolvedValueOnce({
      candidateResults: [],
      manifest: createCompletedManifestWithWorkspaceMode("copy"),
    });

    const manualReviewResponse = await runConsultAction({
      cwd,
      taskInput: "tasks/task.md",
    });

    expect(manualReviewResponse.userInteraction).toBeUndefined();
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

    await runConsultAction(
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

    await runConsultAction({
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
    await runPlanAction({
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
      runConsultAction({
        cwd: "/tmp/project",
        taskInput: "tasks/task.md",
        agent: "codex",
      } as Parameters<typeof runConsultAction>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedPlanRun).not.toHaveBeenCalled();

    await expect(
      runPlanAction({
        cwd: "/tmp/project",
        taskInput: "fix login",
        candidates: 2,
        deliberate: true,
        timeoutMs: 1200,
      } as Parameters<typeof runPlanAction>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedPlanRun).not.toHaveBeenCalled();
  });
  it("runs plan without executing candidates", async () => {
    const response = await runPlanAction({
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
  it("returns plan clarification user interaction for answerable preflight blockers", async () => {
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());

    const response = await runPlanAction({
      cwd: "/tmp/project",
      taskInput: "add docs",
    });

    expect(response.userInteraction).toEqual({
      kind: "plan-clarification",
      runId: "run_blocked",
      header: "Plan clarification",
      question: "Which file should Oraculum update?",
      expectedAnswerShape:
        "Answer with the missing task intent, scope boundary, success criteria, non-goal, or judging basis.",
      freeTextAllowed: true,
    });
  });
  it("returns a stable user interaction for Augury questions", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-plan-interaction-");
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());
    await writeJsonArtifact(getPlanningDepthPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      interviewDepth: "interview",
      readiness: "needs-interview",
      confidence: "medium",
      summary: "Clarify the task.",
      reasons: ["Missing success criteria."],
      estimatedInterviewRounds: 1,
      consensusReviewIntensity: "standard",
      maxInterviewRounds: 8,
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 2,
    });
    await writeJsonArtifact(getPlanningInterviewPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      status: "needs-clarification",
      taskId: "task-1",
      interviewDepth: "interview",
      rounds: [
        {
          round: 1,
          question: "Which route should be protected?",
          perspective: "scope",
          expectedAnswerShape: "Name the route and success signal.",
          suggestedAnswers: [
            {
              label: "Protect dashboard",
              description: "Protect /dashboard and prove signed-out users redirect.",
            },
            {
              label: "Protect admin",
              description: "Protect /admin and prove signed-out users redirect.",
            },
          ],
        },
      ],
      nextQuestion: "Which route should be protected?",
    });

    const response = await runPlanAction({
      cwd,
      taskInput: "add authentication",
    });

    expect(response.userInteraction).toEqual({
      kind: "augury-question",
      runId: "run_blocked",
      header: "Augury",
      question: "Which route should be protected?",
      expectedAnswerShape: "Name the route and success signal.",
      options: [
        {
          label: "Protect dashboard",
          description: "Protect /dashboard and prove signed-out users redirect.",
        },
        {
          label: "Protect admin",
          description: "Protect /admin and prove signed-out users redirect.",
        },
      ],
      freeTextAllowed: true,
      round: 1,
      maxRounds: 8,
    });
  });
  it("sanitizes Augury user interaction options before exposing host UI choices", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-plan-interaction-options-");
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());
    await writeJsonArtifact(getPlanningDepthPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      interviewDepth: "interview",
      readiness: "needs-interview",
      confidence: "medium",
      summary: "Clarify the task.",
      reasons: ["Missing success criteria."],
      estimatedInterviewRounds: 1,
      consensusReviewIntensity: "standard",
      maxInterviewRounds: 8,
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 2,
    });
    await writeJsonArtifact(getPlanningInterviewPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      status: "needs-clarification",
      taskId: "task-1",
      interviewDepth: "interview",
      rounds: [
        {
          round: 1,
          question: "Which route should be protected?",
          perspective: "scope",
          expectedAnswerShape: "Name the route and success signal.",
          suggestedAnswers: [
            { label: "Dashboard", description: "Protect /dashboard." },
            { label: "dashboard", description: "Duplicate label should be dropped." },
            { label: " ", description: "Blank label should be dropped." },
            { label: "Admin", description: "Protect /admin." },
            { label: "Reports", description: "Protect /reports." },
            { label: "Settings", description: "Protect /settings." },
            { label: "Billing", description: "Fifth valid option should be dropped." },
          ],
        },
      ],
      nextQuestion: "Which route should be protected?",
    });

    const response = await runPlanAction({
      cwd,
      taskInput: "add authentication",
    });

    expect(response.userInteraction?.options).toEqual([
      { label: "Dashboard", description: "Protect /dashboard." },
      { label: "Admin", description: "Protect /admin." },
      { label: "Reports", description: "Protect /reports." },
      { label: "Settings", description: "Protect /settings." },
    ]);
  });
  it("routes Augury answers through the common answer action", async () => {
    const response = await runUserInteractionAnswerAction({
      cwd: "/tmp/project",
      kind: "augury-question",
      runId: "run_blocked",
      answer: "Protect /dashboard; no OAuth.",
    });

    expect(mockedAnswerPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      runId: "run_blocked",
      answer: "Protect /dashboard; no OAuth.",
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
    expect(mockedPlanRun).not.toHaveBeenCalled();
    expect(mockedWriteLatestRunState).toHaveBeenCalledWith("/tmp/project", "run_1");
    expect(response.mode).toBe("plan");
  });
  it("routes plan clarification answers through explicit planning with the source task", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-plan-clarification-answer-");
    mockedReadRunManifest.mockResolvedValueOnce(createBlockedPreflightManifest());
    await writeJsonArtifact(getPlanningDepthPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      interviewDepth: "skip-interview",
      readiness: "ready",
      confidence: "medium",
      summary: "Clarify the task.",
      reasons: ["Missing source path."],
      estimatedInterviewRounds: 0,
      consensusReviewIntensity: "standard",
      maxInterviewRounds: 8,
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 1,
    });

    const response = await runUserInteractionAnswerAction({
      cwd,
      kind: "plan-clarification",
      runId: "run_blocked",
      answer: "Update docs/session.md and require a migration note.",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd,
      taskInput: "/tmp/task.md",
      agent: "codex",
      clarificationAnswer: "Update docs/session.md and require a migration note.",
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
    expect(response.mode).toBe("plan");
  });
  it("routes consult clarification answers through consult-lite and executes when preflight passes", async () => {
    mockedReadRunManifest.mockResolvedValueOnce(createBlockedPreflightManifest());

    const response = await runUserInteractionAnswerAction({
      cwd: "/tmp/project",
      kind: "consult-clarification",
      runId: "run_blocked",
      answer: "Update docs/session.md and require a migration note.",
    });

    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      taskInput: "/tmp/task.md",
      agent: "codex",
      clarificationAnswer: "Update docs/session.md and require a migration note.",
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
    expect(response.mode).toBe("consult");
  });
  it("routes workspace-sync apply approval through crown materialization", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-apply-workspace-");
    const manifest = createCompletedManifestWithWorkspaceMode("copy");
    mockedReadRunManifest.mockResolvedValue(manifest);
    await writeJsonArtifact(getExportSyncSummaryPath(cwd, "run_1"), {
      appliedFiles: ["app.txt"],
      removedFiles: [],
    });
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: getExportPlanPath(cwd, "run_1"),
    });

    const response = await runUserInteractionAnswerAction({
      cwd,
      kind: "apply-approval",
      runId: "run_1",
      answer: "Apply",
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd,
      runId: "run_1",
      withReport: false,
    });
    expect(response.mode).toBe("crown");
  });
  it("routes git apply approval through direct working-tree materialization", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-apply-git-");
    const manifest = createCompletedManifestWithWorkspaceMode("git-worktree");
    const patchPath = await writeExportPatch(cwd, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedReadRunManifest.mockResolvedValue(manifest);
    mockedRunSubprocess.mockResolvedValueOnce(createSubprocessResult({ stdout: "main\n" }));
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "git-apply",
        materializationMode: "working-tree",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: getExportPlanPath(cwd, "run_1"),
    });

    const response = await runUserInteractionAnswerAction({
      cwd,
      kind: "apply-approval",
      runId: "run_1",
      answer: "Apply",
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd,
      runId: "run_1",
      withReport: false,
    });
    expect(response.mode).toBe("crown");
  });
  it("uses a free-text apply approval answer as a git apply label", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-apply-git-label-");
    const manifest = createCompletedManifestWithWorkspaceMode("git-worktree");
    const patchPath = await writeExportPatch(cwd, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedReadRunManifest.mockResolvedValue(manifest);
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "git-apply",
        materializationMode: "working-tree",
        workspaceDir: "/tmp/workspace",
        materializationLabel: "fix/session-loss",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: getExportPlanPath(cwd, "run_1"),
    });

    const response = await runUserInteractionAnswerAction({
      cwd,
      kind: "apply-approval",
      runId: "run_1",
      answer: "fix/session-loss",
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd,
      runId: "run_1",
      materializationName: "fix/session-loss",
      withReport: false,
    });
    expect(response.mode).toBe("crown");
  });
  it("returns the consult summary without materializing when apply approval is skipped", async () => {
    const manifest = createCompletedManifestWithWorkspaceMode("copy");
    mockedReadRunManifest.mockResolvedValueOnce(manifest);

    const response = await runUserInteractionAnswerAction({
      cwd: "/tmp/project",
      kind: "apply-approval",
      runId: "run_1",
      answer: "Do not apply",
    });

    expect(mockedMaterializeExport).not.toHaveBeenCalled();
    expect(response.mode).toBe("consult");
    if (response.mode === "consult") {
      expect(response.userInteraction).toBeUndefined();
    }
  });
  it("rejects apply approval for non-crownable runs", async () => {
    mockedReadRunManifest.mockResolvedValueOnce(createFinalistsWithoutRecommendationManifest());

    await expect(
      runUserInteractionAnswerAction({
        cwd: "/tmp/project",
        kind: "apply-approval",
        runId: "run_1",
        answer: "Apply",
      }),
    ).rejects.toThrow('Run "run_1" is not crownable for apply approval.');
  });
  it("rejects apply approval when another interaction kind is active", async () => {
    mockedReadRunManifest.mockResolvedValueOnce(createBlockedPreflightManifest());

    await expect(
      runUserInteractionAnswerAction({
        cwd: "/tmp/project",
        kind: "apply-approval",
        runId: "run_blocked",
        answer: "Apply",
      }),
    ).rejects.toThrow(
      'Run "run_blocked" has an active consult-clarification interaction, not apply-approval.',
    );
  });
  it("rejects apply approval for already materialized runs", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-apply-exported-");
    await writeExportPlanArtifact(cwd, "run_1", "cand-01");
    mockedReadRunManifest.mockResolvedValueOnce(
      createCompletedManifestWithWorkspaceMode("copy", {
        candidates: [
          createCandidate("cand-01", {
            status: "exported",
            workspaceMode: "copy",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
          }),
        ],
      }),
    );

    await expect(
      runUserInteractionAnswerAction({
        cwd,
        kind: "apply-approval",
        runId: "run_1",
        answer: "Apply",
      }),
    ).rejects.toThrow('Run "run_1" already has a materialized recommended result.');
  });
  it("rejects blank common interaction answers", async () => {
    await expect(
      runUserInteractionAnswerAction({
        cwd: "/tmp/project",
        kind: "consult-clarification",
        runId: "run_blocked",
        answer: "   ",
      }),
    ).rejects.toThrow("User interaction answer must not be blank.");
  });
  it("rejects common answer kind mismatches against the active interaction", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-kind-mismatch-");
    mockedReadRunManifest.mockResolvedValueOnce(createBlockedPreflightManifest());
    await writeJsonArtifact(getPlanningDepthPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      interviewDepth: "skip-interview",
      readiness: "ready",
      confidence: "medium",
      summary: "Clarify the task.",
      reasons: ["Missing source path."],
      estimatedInterviewRounds: 0,
      consensusReviewIntensity: "standard",
      maxInterviewRounds: 8,
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 1,
    });

    await expect(
      runUserInteractionAnswerAction({
        cwd,
        kind: "consult-clarification",
        runId: "run_blocked",
        answer: "Use docs/session.md.",
      }),
    ).rejects.toThrow(
      'Run "run_blocked" has an active plan-clarification interaction, not consult-clarification.',
    );
  });
  it("omits Augury user interactions whose round exceeds the configured cap", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-plan-interaction-cap-");
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());
    await writeJsonArtifact(getPlanningDepthPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      interviewDepth: "interview",
      readiness: "needs-interview",
      confidence: "medium",
      summary: "Clarify the task.",
      reasons: ["Missing success criteria."],
      estimatedInterviewRounds: 0,
      consensusReviewIntensity: "standard",
      maxInterviewRounds: 0,
      operatorMaxConsensusRevisions: 10,
      maxConsensusRevisions: 2,
    });
    await writeJsonArtifact(getPlanningInterviewPath(cwd, "run_blocked"), {
      runId: "run_blocked",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      status: "needs-clarification",
      taskId: "task-1",
      interviewDepth: "interview",
      rounds: [
        {
          round: 1,
          question: "Which route should be protected?",
          perspective: "scope",
          expectedAnswerShape: "Name the route and success signal.",
        },
      ],
      nextQuestion: "Which route should be protected?",
    });

    const response = await runPlanAction({
      cwd,
      taskInput: "add authentication",
    });

    expect(response.userInteraction).toBeUndefined();
  });
  it("returns blocked preflight consultations without executing candidates", async () => {
    mockedPlanRun.mockResolvedValue(createBlockedPreflightManifest());
    const progress: ConsultProgressEvent[] = [];

    const response = await runConsultAction(
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
        "review-preflight-readiness",
        "answer-clarification-and-rerun",
      ],
    });
    expect(response.userInteraction).toEqual({
      kind: "consult-clarification",
      runId: "run_blocked",
      header: "Consult clarification",
      question: "Which file should Oraculum update?",
      expectedAnswerShape:
        "Answer with the missing implementation scope, target artifact, acceptance signal, or constraint needed before candidate execution.",
      freeTextAllowed: true,
    });
  });

  it("resumes the latest running consultation when consult has no task input", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-bare-consult-running-");
    await writeJsonArtifact(
      getRunManifestPath(cwd, "run_resume"),
      runManifestSchema.parse({
        ...createRunManifestFixture({
          runId: "run_resume",
          status: "planned",
          rounds: [
            createRunRoundFixture("running", {
              startedAt: "2026-04-04T00:10:00.000Z",
            }),
          ],
          candidates: [
            createRunCandidateFixture("cand-01", "running", {
              taskPacketPath: "/tmp/cand-01.task-packet.json",
              workspaceDir: "/tmp/cand-01",
            }),
          ],
          overrides: {
            taskPacket: createTaskPacketFixture(),
            updatedAt: "2026-04-04T00:10:00.000Z",
          },
        }),
        status: "running",
        outcome: {
          type: "running",
          terminal: false,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    );

    await runConsultAction({
      cwd,
    });

    expect(mockedEnsureProjectInitialized).not.toHaveBeenCalled();
    expect(mockedPlanRun).not.toHaveBeenCalled();
    expect(mockedExecuteRun).toHaveBeenCalledWith({
      cwd,
      runId: "run_resume",
    });
  });

  it("executes the latest ready consultation plan when consult has no task input", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-bare-consult-plan-");
    const runId = "run_ready_plan";
    const planPath = getConsultationPlanPath(cwd, runId);
    await writeJsonArtifact(
      getRunManifestPath(cwd, runId),
      runManifestSchema.parse(
        createRunManifestFixture({
          runId,
          status: "planned",
          rounds: [createRunRoundFixture("pending")],
          candidates: [
            createRunCandidateFixture("cand-01", "planned", {
              taskPacketPath: "/tmp/cand-01.task-packet.json",
              workspaceDir: "/tmp/cand-01",
            }),
          ],
          overrides: {
            taskPacket: createTaskPacketFixture(),
            updatedAt: "2026-04-04T00:20:00.000Z",
          },
        }),
      ),
    );
    await writeJsonArtifact(
      planPath,
      consultationPlanArtifactSchema.parse({
        runId,
        createdAt: "2026-04-04T00:20:00.000Z",
        readyForConsult: true,
        recommendedNextAction: `Execute the planned consultation: \`orc consult .oraculum/runs/${runId}/reports/consultation-plan.json\`.`,
        intendedResult: "recommended result",
        decisionDrivers: ["Use the persisted consultation plan."],
        openQuestions: [],
        task: {
          id: "task",
          title: "Task",
          intent: "Execute the ready plan.",
          nonGoals: [],
          acceptanceCriteria: [],
          risks: [],
          oracleHints: [],
          strategyHints: [],
          contextFiles: [],
          source: {
            kind: "task-note",
            path: "/tmp/task.md",
          },
        },
        preflight: {
          decision: "proceed",
          confidence: "medium",
          summary: "Proceed conservatively.",
          researchPosture: "repo-only",
        },
        repoBasis: {
          projectRoot: cwd,
          signalFingerprint: "sha256:ready-plan",
          availableOracleIds: ["lint-fast"],
        },
        candidateCount: 1,
        plannedStrategies: [{ id: "minimal-change", label: "Minimal Change" }],
        oracleIds: ["lint-fast"],
        roundOrder: [{ id: "fast", label: "Fast" }],
        workstreams: [],
        stagePlan: [],
        scorecardDefinition: {
          dimensions: [],
          abstentionTriggers: [],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: [],
          preferAbstainOverRetry: [],
        },
      }),
    );
    await writeJsonArtifact(
      getConsultationPlanReadinessPath(cwd, runId),
      consultationPlanReadinessSchema.parse({
        runId,
        status: "clear",
        readyForConsult: true,
        blockers: [],
        warnings: [],
        staleBasis: false,
        missingOracleIds: [],
        unresolvedQuestions: [],
        reviewStatus: "not-run",
        nextAction: `Execute the planned consultation: \`orc consult .oraculum/runs/${runId}/reports/consultation-plan.json\`.`,
      }),
    );

    await runConsultAction({
      cwd,
    });

    expect(mockedEnsureProjectInitialized).not.toHaveBeenCalled();
    expect(mockedPlanRun).toHaveBeenCalledWith({
      cwd,
      taskInput: planPath,
      preflight: {
        allowRuntime: true,
      },
      autoProfile: {
        allowRuntime: true,
      },
    });
  });

  it("returns a clear error when bare consult has no running consultation or ready plan", async () => {
    const cwd = await createOrcActionTempRoot("oraculum-orc-actions-bare-consult-empty-");

    await expect(
      runConsultAction({
        cwd,
      }),
    ).rejects.toThrow(
      'No resumable consultation or ready consultation plan found. Start with `orc plan "<task>"`, `orc consult "<task>"`, or `orc consult <consultation-plan-path>`.',
    );
    expect(mockedPlanRun).not.toHaveBeenCalled();
    expect(mockedExecuteRun).not.toHaveBeenCalled();
  });
});

function createCompletedManifestWithWorkspaceMode(
  workspaceMode: NonNullable<RunManifest["candidates"][number]["workspaceMode"]>,
  overrides: {
    outcome?: Partial<NonNullable<RunManifest["outcome"]>>;
    profileSelection?: Partial<NonNullable<RunManifest["profileSelection"]>>;
    recommendedWinner?: Partial<NonNullable<RunManifest["recommendedWinner"]>>;
    candidates?: RunManifest["candidates"];
  } = {},
): RunManifest {
  const base = createCompletedManifest();

  return runManifestSchema.parse({
    ...base,
    profileSelection: {
      ...(base.profileSelection ?? {}),
      ...(overrides.profileSelection ?? {}),
    },
    recommendedWinner: {
      ...(base.recommendedWinner ?? {}),
      ...(overrides.recommendedWinner ?? {}),
    },
    outcome: {
      ...(base.outcome ?? {}),
      ...(overrides.outcome ?? {}),
    },
    candidates: overrides.candidates ?? [
      createCandidate("cand-01", {
        status: "promoted",
        workspaceMode,
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
      }),
    ],
  });
}
