import { mkdir } from "node:fs/promises";
import {
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
  getPlanConsensusPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getPlanningSpecMarkdownPath,
  getPlanningSpecPath,
  getResearchBriefPath,
  getRunConfigPath,
  getRunDir,
} from "../../src/core/paths.js";
import { crownToolResponseSchema } from "../../src/domain/chat-native.js";
import {
  consultationPlanArtifactSchema,
  consultationResearchBriefSchema,
  planConsensusArtifactSchema,
  planningDepthArtifactSchema,
  planningInterviewArtifactSchema,
  planningSpecArtifactSchema,
} from "../../src/domain/run.js";
import { createTempRootHarness, writeJsonArtifact, writeTextArtifact } from "./fs.js";
import {
  ensureRunReportsDir,
  writeClarifyFollowUp,
  writeComparisonArtifacts,
  writeExportPlanArtifact,
  writeFailureAnalysis,
  writeProfileSelectionArtifact,
  writeSecondOpinionWinnerSelection,
  writePreflightReadinessArtifact as writeSharedPreflightReadinessArtifact,
  writeWinnerSelection,
} from "./run-artifacts.js";

export { writeJsonArtifact, writeTextArtifact };

const tempRootHarness = createTempRootHarness("oraculum-chat-native-");

export function registerChatNativeTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createChatNativeTempRoot(prefix = "oraculum-chat-native-"): Promise<string> {
  return tempRootHarness.createTempRoot(prefix);
}

export function createCrownToolResponse(candidateId: string) {
  return crownToolResponseSchema.parse({
    mode: "crown",
    plan: {
      runId: "run_1",
      winnerId: candidateId,
      branchName: "fix/session-loss",
      mode: "git-branch",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      patchPath: "/tmp/export.patch",
      materializationPatchPath: "/tmp/export.patch",
      withReport: false,
      createdAt: "2026-04-05T00:00:00.000Z",
    },
    recordPath: "/tmp/export-plan.json",
    materialization: {
      materialized: true,
      verified: true,
      mode: "git-branch",
      materializationMode: "branch",
      branchName: "fix/session-loss",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
      checks: [
        {
          id: "current-branch",
          status: "passed",
          summary: "Current git branch is fix/session-loss.",
        },
      ],
    },
    consultation: {
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task-1",
        title: "Fix session loss",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      rounds: [],
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: candidateId,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      recommendedWinner: {
        candidateId,
        confidence: "high",
        source: "llm-judge",
        summary: `${candidateId} is the recommended survivor.`,
      },
      candidates: [
        {
          id: candidateId,
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    },
    status: {
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      finalistCount: 1,
      validationPosture: "sufficient",
      validationGapCount: 0,
      validationGapsPresent: false,
      verificationLevel: "lightweight",
      judgingBasisKind: "repo-local-oracle",
      researchPosture: "repo-only",
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-result"],
      recommendedCandidateId: candidateId,
      validationSignals: [],
      validationGaps: [],
      preflightDecision: "proceed",
      updatedAt: "2026-04-05T00:00:00.000Z",
    },
  });
}

export async function writePreflightReadinessArtifact(
  projectRoot: string,
  consultationId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await writeSharedPreflightReadinessArtifact(projectRoot, consultationId, overrides);
}

export async function writeCompleteConsultationArtifacts(
  projectRoot: string,
  consultationId: string,
): Promise<void> {
  await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });
  await ensureRunReportsDir(projectRoot, consultationId);

  await writeTextArtifact(getRunConfigPath(projectRoot, consultationId), "{}\n");
  await writeJsonArtifact(
    getConsultationPlanPath(projectRoot, consultationId),
    consultationPlanArtifactSchema.parse({
      runId: consultationId,
      createdAt: "2026-04-14T00:00:00.000Z",
      readyForConsult: true,
      recommendedNextAction:
        "Execute the planned consultation: `orc consult .oraculum/runs/run_20260409_demo/reports/consultation-plan.json`.",
      intendedResult: "recommended result",
      decisionDrivers: ["Target artifact path: src/session.ts"],
      openQuestions: [],
      task: {
        id: "task",
        title: "Task",
        intent: "Fix the session flow.",
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
      candidateCount: 2,
      plannedStrategies: [
        {
          id: "minimal-change",
          label: "Minimal Change",
        },
      ],
      oracleIds: ["lint-fast"],
      roundOrder: [
        {
          id: "fast",
          label: "Fast",
        },
      ],
    }),
  );
  await writeTextArtifact(
    getConsultationPlanMarkdownPath(projectRoot, consultationId),
    "# Consultation Plan\n\n- Run: run_20260409_demo\n",
  );
  await writeJsonArtifact(
    getPlanningDepthPath(projectRoot, consultationId),
    planningDepthArtifactSchema.parse({
      runId: consultationId,
      createdAt: "2026-04-14T00:00:00.000Z",
      depth: "skip-interview",
      readiness: "ready",
      confidence: "high",
      summary: "The task is ready for planning.",
      reasons: [],
      estimatedInterviewRounds: 0,
      consensusReviewDepth: "standard",
      maxInterviewRounds: 8,
      maxConsensusRevisions: 3,
    }),
  );
  await writeJsonArtifact(
    getPlanningInterviewPath(projectRoot, consultationId),
    planningInterviewArtifactSchema.parse({
      runId: consultationId,
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
      status: "ready-for-spec",
      taskId: "task",
      depth: "skip-interview",
      rounds: [],
    }),
  );
  await writeJsonArtifact(
    getPlanningSpecPath(projectRoot, consultationId),
    planningSpecArtifactSchema.parse({
      runId: consultationId,
      createdAt: "2026-04-14T00:00:00.000Z",
      taskId: "task",
      goal: "Fix the session flow.",
      constraints: [],
      nonGoals: [],
      acceptanceCriteria: [],
      assumptionsResolved: [],
      assumptionLedger: [],
      repoEvidence: [],
      openRisks: [],
    }),
  );
  await writeTextArtifact(
    getPlanningSpecMarkdownPath(projectRoot, consultationId),
    "# Planning Spec\n\n- Run: run_20260409_demo\n",
  );
  await writeJsonArtifact(
    getPlanConsensusPath(projectRoot, consultationId),
    planConsensusArtifactSchema.parse({
      runId: consultationId,
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
      approved: true,
      maxRevisions: 1,
      principles: [],
      decisionDrivers: [],
      viableOptions: [{ name: "minimal", rationale: "Use the smallest safe change." }],
      selectedOption: { name: "minimal", rationale: "Use the smallest safe change." },
      rejectedAlternatives: [],
      architectAntithesis: [],
      criticVerdicts: [],
      revisionHistory: [],
      finalDraft: {
        summary: "Use the smallest safe change.",
        principles: [],
        decisionDrivers: [],
        viableOptions: [{ name: "minimal", rationale: "Use the smallest safe change." }],
        selectedOption: { name: "minimal", rationale: "Use the smallest safe change." },
        rejectedAlternatives: [],
        plannedJudgingCriteria: [],
        crownGates: [],
        requiredChangedPaths: [],
        protectedPaths: [],
        workstreams: [],
        stagePlan: [],
        assumptionLedger: [],
        premortem: [],
        expandedTestPlan: [],
      },
    }),
  );
  await writePreflightReadinessArtifact(projectRoot, consultationId);
  await writeComparisonArtifacts(projectRoot, consultationId, {
    jsonOverrides: {
      generatedAt: "2026-04-14T00:00:00.000Z",
      verificationLevel: "lightweight",
    },
  });
  await writeClarifyFollowUp(projectRoot, consultationId, {
    runId: consultationId,
    adapter: "codex",
    decision: "needs-clarification",
    scopeKeyType: "target-artifact",
    scopeKey: "docs/SESSION_PLAN.md",
    repeatedCaseCount: 2,
    repeatedKinds: ["clarify-needed"],
    recurringReasons: ["Which sections are required?"],
    summary: "The document contract is still underspecified.",
    keyQuestion: "Which sections are required?",
    missingResultContract: "The expected section contract is still missing.",
    missingJudgingBasis: "The judging basis for the document is still missing.",
  });
  await writeJsonArtifact(
    getResearchBriefPath(projectRoot, consultationId),
    consultationResearchBriefSchema.parse({
      runId: consultationId,
      decision: "external-research-required",
      question: "What does the official API documentation say?",
      researchPosture: "external-research-required",
      summary: "Official documentation is still required.",
      task: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      notes: [],
      signalSummary: [],
    }),
  );
  await writeFailureAnalysis(projectRoot, consultationId, {
    runId: consultationId,
    generatedAt: "2026-04-14T00:00:00.000Z",
    trigger: "finalists-without-recommendation",
    summary: "Investigate before rerun.",
    recommendedAction: "investigate-root-cause-before-rerun",
    validationGaps: [],
    candidates: [],
  });
  await writeWinnerSelection(projectRoot, consultationId, {
    runId: consultationId,
    adapter: "codex",
    status: "completed",
    startedAt: "2026-04-14T00:00:00.000Z",
    completedAt: "2026-04-14T00:00:01.000Z",
    exitCode: 0,
    summary: "Judge selected cand-01.",
    recommendation: {
      decision: "select",
      candidateId: "cand-01",
      confidence: "high",
      summary: "cand-01 is the recommended promotion.",
    },
    artifacts: [],
  });
  await writeSecondOpinionWinnerSelection(projectRoot, consultationId, {
    runId: consultationId,
    advisoryOnly: true,
    adapter: "claude-code",
    triggerKinds: ["low-confidence"],
    triggerReasons: ["Primary judge confidence was low."],
    primaryRecommendation: {
      source: "llm-judge",
      decision: "select",
      candidateId: "cand-01",
      confidence: "low",
      summary: "cand-01 remained the leading primary recommendation.",
    },
    result: {
      runId: consultationId,
      adapter: "claude-code",
      status: "completed",
      startedAt: "2026-04-14T00:00:00.000Z",
      completedAt: "2026-04-14T00:00:01.000Z",
      exitCode: 0,
      summary: "Second opinion agreed with cand-01.",
      recommendation: {
        decision: "select",
        candidateId: "cand-01",
        confidence: "medium",
        summary: "cand-01 remains the safest recommendation.",
      },
      artifacts: [],
    },
    agreement: "agrees-select",
    advisorySummary: "The second opinion agrees with the primary recommendation.",
  });
  await writeProfileSelectionArtifact(projectRoot, consultationId, {
    validationProfileId: "generic",
    confidence: "low",
    source: "fallback-detection",
    validationSummary: "No executable validation evidence was detected.",
    candidateCount: 3,
    strategyIds: ["minimal-change"],
    oracleIds: [],
    validationGaps: ["No repo-local validation command was detected."],
    validationSignals: [],
  });
  await writeExportPlanArtifact(projectRoot, consultationId, "cand-01");
}
