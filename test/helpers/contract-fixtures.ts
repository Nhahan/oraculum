import { join } from "node:path";

import { type VerdictReview, verdictReviewSchema } from "../../src/domain/chat-native.js";
import {
  type ConsultationPlanArtifact,
  consultationPlanArtifactSchema,
} from "../../src/domain/run.js";
import {
  type MaterializedTaskPacket,
  materializedTaskPacketSchema,
  type TaskPacketSummary,
  taskPacketSummarySchema,
} from "../../src/domain/task.js";

export function createMaterializedTaskPacketFixture(
  overrides: Partial<MaterializedTaskPacket> = {},
): MaterializedTaskPacket {
  return materializedTaskPacketSchema.parse({
    id: "task",
    title: "Task",
    intent: "Fix the bug.",
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
    ...overrides,
  });
}

export function createTaskPacketSummaryFixture(
  overrides: Partial<TaskPacketSummary> = {},
): TaskPacketSummary {
  return taskPacketSummarySchema.parse({
    id: "task",
    title: "Task",
    sourceKind: "task-note",
    sourcePath: "/tmp/task.md",
    ...overrides,
  });
}

export function createDocumentTaskPacketFixture(
  projectRoot: string,
  overrides: Partial<MaterializedTaskPacket> = {},
): MaterializedTaskPacket {
  return createProjectTaskPacketFixture(projectRoot, {
    artifactKind: "document",
    targetArtifactPath: "docs/PRD.md",
    ...overrides,
  });
}

export function createProjectTaskPacketFixture(
  projectRoot: string,
  overrides: Partial<MaterializedTaskPacket> = {},
): MaterializedTaskPacket {
  return createMaterializedTaskPacketFixture({
    source: {
      kind: "task-note",
      path: join(projectRoot, "task.md"),
    },
    ...overrides,
  });
}

export function createConsultationPlanArtifactFixture(
  projectRoot: string,
  runId: string,
  reportsDir: string,
  overrides: Partial<ConsultationPlanArtifact> = {},
): ConsultationPlanArtifact {
  return consultationPlanArtifactSchema.parse({
    runId,
    createdAt: "2026-04-05T00:00:00.000Z",
    mode: "standard",
    readyForConsult: true,
    recommendedNextAction: `orc consult .oraculum/runs/${runId}/reports/consultation-plan.json`,
    intendedResult: "recommended result for docs/PRD.md",
    decisionDrivers: ["Target artifact path: docs/PRD.md"],
    plannedJudgingCriteria: [
      "Directly improves docs/PRD.md instead of only adjacent files.",
      "Leaves the planned document result internally consistent and reviewable.",
    ],
    crownGates: [
      "Do not recommend finalists that fail to materially change docs/PRD.md.",
      "Abstain if no finalist leaves the planned document result reviewable and internally consistent.",
    ],
    openQuestions: [],
    repoBasis: {
      projectRoot,
      signalFingerprint: "sha256:test",
      availableOracleIds: [],
    },
    task: createDocumentTaskPacketFixture(projectRoot, {
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "consultation-plan",
        path: join(reportsDir, "consultation-plan.json"),
      },
    }),
    candidateCount: 1,
    plannedStrategies: [],
    oracleIds: [],
    requiredChangedPaths: ["docs/PRD.md"],
    protectedPaths: [],
    roundOrder: [],
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
    ...overrides,
  });
}

export function createVerdictReviewFixture(overrides: Partial<VerdictReview> = {}): VerdictReview {
  return verdictReviewSchema.parse({
    outcomeType: "recommended-survivor",
    verificationLevel: "lightweight",
    validationPosture: "sufficient",
    judgingBasisKind: "repo-local-oracle",
    taskSourceKind: "task-note",
    taskSourcePath: "/tmp/task.md",
    researchSignalCount: 0,
    researchRerunRecommended: false,
    researchSourceCount: 0,
    researchClaimCount: 0,
    researchVersionNoteCount: 0,
    researchConflictCount: 0,
    researchConflictsPresent: false,
    researchBasisStatus: "unknown",
    recommendedCandidateId: "cand-01",
    finalistIds: ["cand-01"],
    strongestEvidence: [],
    weakestEvidence: [],
    secondOpinionTriggerKinds: [],
    secondOpinionTriggerReasons: [],
    manualReviewRecommended: false,
    manualCrowningCandidateIds: [],
    validationProfileId: "library",
    validationSummary: "Package export evidence is strongest.",
    validationSignals: ["package-export"],
    validationGaps: [],
    researchPosture: "repo-only",
    artifactAvailability: {
      preflightReadiness: false,
      clarifyFollowUp: false,
      researchBrief: false,
      failureAnalysis: false,
      profileSelection: false,
      comparisonReport: false,
      winnerSelection: false,
      secondOpinionWinnerSelection: false,
      crowningRecord: false,
    },
    candidateStateCounts: {
      promoted: 1,
    },
    ...overrides,
  });
}
