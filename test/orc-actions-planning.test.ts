import { describe, expect, it, vi } from "vitest";
import {
  getConsultationPlanPath,
  getConsultationPlanReadinessPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import {
  consultationPlanArtifactSchema,
  consultationPlanReadinessSchema,
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
  createCompletedManifest,
  createOrcActionTempRoot,
  mockedAnswerPlanRun,
  mockedEnsureProjectInitialized,
  mockedExecuteRun,
  mockedPlanRun,
  mockedReadRunManifest,
  mockedRenderConsultationSummary,
  mockedWriteLatestRunState,
  registerOrcActionsTestHarness,
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
