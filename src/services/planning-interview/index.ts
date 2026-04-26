import { readFile } from "node:fs/promises";

import type { AgentAdapter } from "../../adapters/types.js";
import { OraculumError } from "../../core/errors.js";
import {
  consultationPlanArtifactSchema,
  type PlanningDepthArtifact,
  type PlanningInterviewArtifact,
  type PlanningSpecArtifact,
  planningDepthArtifactSchema,
  planningInterviewArtifactSchema,
  planningSpecArtifactSchema,
  runManifestSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import type { ProjectConfigLayers } from "../project.js";
import { pathExists, writeJsonFile, writeTextFileAtomically } from "../project.js";
import { RunStore } from "../run-store.js";
import { loadTaskPacket } from "../task-packets.js";

export interface PlanningLoopCaps {
  explicitPlanMaxInterviewRounds: number;
  explicitPlanMaxConsensusRevisions: number;
  explicitPlanModelCallTimeoutMs: number;
  consultLiteMaxPlanningCalls: number;
}

export const DEFAULT_PLANNING_LOOP_CAPS: PlanningLoopCaps = {
  explicitPlanMaxInterviewRounds: 8,
  explicitPlanMaxConsensusRevisions: 10,
  explicitPlanModelCallTimeoutMs: 120_000,
  consultLiteMaxPlanningCalls: 1,
};

export const HARD_MAX_CONSENSUS_LOOP_REVISIONS = 10;

const CONSENSUS_LOOP_REVISION_BUDGET_BY_DEPTH: Record<
  PlanningDepthArtifact["consensusReviewIntensity"],
  Record<PlanningDepthArtifact["interviewDepth"], number>
> = {
  standard: {
    "skip-interview": 1,
    interview: 2,
    "deep-interview": 3,
  },
  elevated: {
    "skip-interview": 3,
    interview: 4,
    "deep-interview": 5,
  },
  high: {
    "skip-interview": 6,
    interview: 7,
    "deep-interview": 10,
  },
};

export function resolveConsensusLoopRevisionBudget(options: {
  consensusReviewIntensity: PlanningDepthArtifact["consensusReviewIntensity"];
  interviewDepth: PlanningDepthArtifact["interviewDepth"];
  operatorMaxConsensusLoopRevisions: number;
}): number {
  return Math.min(
    CONSENSUS_LOOP_REVISION_BUDGET_BY_DEPTH[options.consensusReviewIntensity][
      options.interviewDepth
    ],
    Math.max(0, options.operatorMaxConsensusLoopRevisions),
    HARD_MAX_CONSENSUS_LOOP_REVISIONS,
  );
}

export function resolvePlanningLoopCaps(configLayers: ProjectConfigLayers): PlanningLoopCaps {
  return {
    explicitPlanMaxInterviewRounds:
      configLayers.advanced?.planning?.explicitPlanMaxInterviewRounds ??
      DEFAULT_PLANNING_LOOP_CAPS.explicitPlanMaxInterviewRounds,
    explicitPlanMaxConsensusRevisions:
      configLayers.advanced?.planning?.explicitPlanMaxConsensusRevisions ??
      DEFAULT_PLANNING_LOOP_CAPS.explicitPlanMaxConsensusRevisions,
    explicitPlanModelCallTimeoutMs:
      configLayers.advanced?.planning?.explicitPlanModelCallTimeoutMs ??
      DEFAULT_PLANNING_LOOP_CAPS.explicitPlanModelCallTimeoutMs,
    consultLiteMaxPlanningCalls:
      configLayers.advanced?.planning?.consultLiteMaxPlanningCalls ??
      DEFAULT_PLANNING_LOOP_CAPS.consultLiteMaxPlanningCalls,
  };
}

export interface ActivePlanningInterviewTarget {
  runId: string;
  depth: PlanningDepthArtifact;
  manifest: Awaited<ReturnType<RunStore["readRunManifest"]>>;
  taskPath: string;
  taskPacket: MaterializedTaskPacket;
  interview: PlanningInterviewArtifact;
}

export async function loadActivePlanningInterviewTarget(
  projectRoot: string,
  runId: string,
): Promise<ActivePlanningInterviewTarget> {
  const store = new RunStore(projectRoot);
  const paths = store.getRunPaths(runId);
  const manifest = await readOptionalArtifact(paths.manifestPath, runManifestSchema);
  if (!manifest || manifest.id !== runId) {
    throw new OraculumError(`No planning run found for Augury answer runId "${runId}".`);
  }

  const depth = await readOptionalArtifact(paths.planningDepthPath, planningDepthArtifactSchema);
  if (!depth || depth.runId !== runId) {
    throw new OraculumError(`Planning run "${runId}" has no planning-depth artifact.`);
  }

  const interview = await readOptionalArtifact(
    paths.planningInterviewPath,
    planningInterviewArtifactSchema,
  );
  if (!interview || interview.runId !== runId) {
    throw new OraculumError(`Planning run "${runId}" has no Augury Interview artifact.`);
  }
  if (interview.status !== "needs-clarification") {
    throw new OraculumError(
      `Planning run "${runId}" does not have an active Augury Interview; current status is "${interview.status}".`,
    );
  }

  const latestRound = interview.rounds.at(-1);
  if (!latestRound || latestRound.round > depth.maxInterviewRounds) {
    throw new OraculumError(
      `Planning run "${runId}" has exhausted the Augury Interview round cap.`,
    );
  }

  const sourceTaskPacket = await loadInterviewSourceTaskPacket({
    consultationPlanPath: paths.consultationPlanPath,
    fallbackTaskPath: manifest.taskPath,
    runId: manifest.id,
  });
  if (!sourceTaskPacket) {
    throw new OraculumError(
      `Planning run "${runId}" cannot continue because its source task artifact is unavailable.`,
    );
  }

  return {
    runId,
    depth,
    manifest,
    taskPath: manifest.taskPath,
    taskPacket: sourceTaskPacket,
    interview,
  };
}

async function loadInterviewSourceTaskPacket(options: {
  consultationPlanPath: string;
  fallbackTaskPath: string;
  runId: string;
}): Promise<MaterializedTaskPacket | undefined> {
  const consultationPlan = await readOptionalArtifact(
    options.consultationPlanPath,
    consultationPlanArtifactSchema,
  );
  if (consultationPlan?.runId === options.runId) {
    return consultationPlan.task;
  }

  try {
    return await loadTaskPacket(options.fallbackTaskPath);
  } catch {
    return undefined;
  }
}

async function readOptionalArtifact<T>(
  path: string,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T | undefined> {
  if (!(await pathExists(path))) {
    return undefined;
  }

  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function recommendPlanningDepthArtifact(options: {
  adapter: AgentAdapter | undefined;
  caps: PlanningLoopCaps;
  createdAt: string;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanningDepthArtifact> {
  if (options.adapter?.recommendPlanningDepth) {
    try {
      const result = await options.adapter.recommendPlanningDepth({
        logDir: options.reportsDir,
        maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
        operatorMaxConsensusLoopRevisions: options.caps.explicitPlanMaxConsensusRevisions,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        const operatorMaxConsensusLoopRevisions = options.caps.explicitPlanMaxConsensusRevisions;
        return planningDepthArtifactSchema.parse({
          runId: options.runId,
          createdAt: options.createdAt,
          ...result.recommendation,
          estimatedInterviewRounds: Math.min(
            result.recommendation.estimatedInterviewRounds,
            options.caps.explicitPlanMaxInterviewRounds,
          ),
          maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
          operatorMaxConsensusRevisions: operatorMaxConsensusLoopRevisions,
          maxConsensusRevisions: resolveConsensusLoopRevisionBudget({
            consensusReviewIntensity: result.recommendation.consensusReviewIntensity,
            interviewDepth: result.recommendation.interviewDepth,
            operatorMaxConsensusLoopRevisions,
          }),
        });
      }
    } catch {
      // Fall back to a conservative no-interview plan when the runtime cannot decide depth.
    }
  }

  return planningDepthArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    interviewDepth: "skip-interview",
    readiness: "ready",
    confidence: "low",
    summary: "Planning depth runtime unavailable; proceeding with the existing task contract.",
    reasons: ["No structured planning depth recommendation was available."],
    estimatedInterviewRounds: 0,
    consensusReviewIntensity: "standard",
    maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
    operatorMaxConsensusRevisions: options.caps.explicitPlanMaxConsensusRevisions,
    maxConsensusRevisions: resolveConsensusLoopRevisionBudget({
      consensusReviewIntensity: "standard",
      interviewDepth: "skip-interview",
      operatorMaxConsensusLoopRevisions: options.caps.explicitPlanMaxConsensusRevisions,
    }),
  });
}

export async function buildPlanningInterviewNeedingAnswer(options: {
  adapter: AgentAdapter | undefined;
  createdAt: string;
  depth: PlanningDepthArtifact;
  priorInterview?: PlanningInterviewArtifact;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanningInterviewArtifact> {
  const fallbackQuestion = buildFallbackQuestion(options.taskPacket);
  let question: {
    question: string;
    perspective: string;
    expectedAnswerShape: string;
    suggestedAnswers?: Array<{ label: string; description: string }>;
  } = fallbackQuestion;

  if (options.adapter?.generatePlanningInterviewQuestion) {
    try {
      const result = await options.adapter.generatePlanningInterviewQuestion({
        depth: options.depth,
        ...(options.priorInterview ? { interview: options.priorInterview } : {}),
        logDir: options.reportsDir,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        question = {
          question: result.recommendation.question,
          perspective: result.recommendation.perspective,
          expectedAnswerShape: result.recommendation.expectedAnswerShape,
          ...(result.recommendation.suggestedAnswers
            ? { suggestedAnswers: result.recommendation.suggestedAnswers }
            : {}),
        };
      }
    } catch {
      // Keep fallback question.
    }
  }

  return buildPlanningInterviewQuestionArtifact({
    createdAt: options.createdAt,
    depth: options.depth,
    ...(options.priorInterview ? { priorInterview: options.priorInterview } : {}),
    question,
    runId: options.runId,
    taskPacket: options.taskPacket,
  });
}

export function buildPlanningInterviewQuestionArtifact(options: {
  createdAt: string;
  depth: PlanningDepthArtifact;
  priorInterview?: PlanningInterviewArtifact;
  question: {
    question: string;
    perspective: string;
    expectedAnswerShape: string;
    suggestedAnswers?: Array<{ label: string; description: string }>;
  };
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): PlanningInterviewArtifact {
  const nextRoundNumber = (options.priorInterview?.rounds.length ?? 0) + 1;

  return planningInterviewArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    status: "needs-clarification",
    taskId: options.taskPacket.id,
    ...(options.priorInterview ? { sourceRunId: options.priorInterview.runId } : {}),
    interviewDepth: options.depth.interviewDepth,
    rounds: [
      ...(options.priorInterview?.rounds ?? []),
      {
        round: nextRoundNumber,
        question: options.question.question,
        perspective: options.question.perspective,
        ...(options.question.expectedAnswerShape
          ? { expectedAnswerShape: options.question.expectedAnswerShape }
          : {}),
        ...toSuggestedAnswersArtifactFields(options.question.suggestedAnswers),
      },
    ],
    nextQuestion: options.question.question,
  });
}

export function normalizePlanningSuggestedAnswers(
  value: Array<{ label: string; description: string }> | undefined,
): Array<{ label: string; description: string }> {
  if (!value) {
    return [];
  }

  const seenLabels = new Set<string>();
  const normalized: Array<{ label: string; description: string }> = [];
  for (const answer of value) {
    const label = answer.label.trim();
    const description = answer.description.trim();
    const labelKey = label.toLowerCase();
    if (!label || !description || seenLabels.has(labelKey)) {
      continue;
    }
    seenLabels.add(labelKey);
    normalized.push({ label, description });
    if (normalized.length >= 4) {
      break;
    }
  }

  return normalized;
}

function toSuggestedAnswersArtifactFields(
  value: Array<{ label: string; description: string }> | undefined,
): { suggestedAnswers: Array<{ label: string; description: string }> } | Record<string, never> {
  const normalized = normalizePlanningSuggestedAnswers(value);
  return normalized.length >= 2 ? { suggestedAnswers: normalized } : {};
}

export async function scorePlanningInterviewAnswer(options: {
  adapter: AgentAdapter | undefined;
  answer: string;
  createdAt: string;
  depth: PlanningDepthArtifact;
  priorInterview: PlanningInterviewArtifact;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanningInterviewArtifact> {
  const baseRounds = options.priorInterview.rounds;
  const lastRound = baseRounds.at(-1);
  if (!lastRound) {
    return buildPlanningInterviewNeedingAnswer(options);
  }

  let score:
    | NonNullable<
        Awaited<
          ReturnType<NonNullable<AgentAdapter["scorePlanningInterviewRound"]>>
        >["recommendation"]
      >
    | undefined;
  if (options.adapter?.scorePlanningInterviewRound) {
    try {
      const result = await options.adapter.scorePlanningInterviewRound({
        answer: options.answer,
        interview: options.priorInterview,
        logDir: options.reportsDir,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        score = result.recommendation;
      }
    } catch {
      score = undefined;
    }
  }

  const fallbackReady =
    options.priorInterview.rounds.length >= options.depth.estimatedInterviewRounds;
  const scoredRound = {
    ...lastRound,
    answer: options.answer,
    clarityScore: score?.clarityScore ?? (fallbackReady ? 0.8 : 0.5),
    weakestDimension: score?.weakestDimension ?? "unscored-runtime",
    readyForSpec: score?.readyForSpec ?? fallbackReady,
    assumptions: score?.assumptions ?? [],
    ...(score?.ontologySnapshot ? { ontologySnapshot: score.ontologySnapshot } : {}),
  };
  const rounds = [...baseRounds.slice(0, -1), scoredRound];
  const clarityScore = scoredRound.clarityScore;
  const capReached = rounds.length >= options.depth.maxInterviewRounds;
  const readyForSpec = scoredRound.readyForSpec;
  const blocked = !readyForSpec && capReached;

  return planningInterviewArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    status: readyForSpec ? "ready-for-spec" : blocked ? "blocked" : "needs-clarification",
    taskId: options.taskPacket.id,
    sourceRunId: options.priorInterview.runId,
    interviewDepth: options.depth.interviewDepth,
    rounds,
    clarityScore,
    weakestDimension: scoredRound.weakestDimension,
    assumptions: scoredRound.assumptions,
    ontologySnapshots: rounds.flatMap((round) =>
      round.ontologySnapshot ? [round.ontologySnapshot] : [],
    ),
    ...(!readyForSpec && !blocked ? { nextQuestion: lastRound.question } : {}),
  });
}

export async function crystallizePlanningSpecArtifact(options: {
  adapter: AgentAdapter | undefined;
  createdAt: string;
  depth: PlanningDepthArtifact;
  interview?: PlanningInterviewArtifact;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanningSpecArtifact> {
  if (options.adapter?.crystallizePlanningSpec) {
    try {
      const result = await options.adapter.crystallizePlanningSpec({
        depth: options.depth,
        ...(options.interview ? { interview: options.interview } : {}),
        logDir: options.reportsDir,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        return planningSpecArtifactSchema.parse({
          runId: options.runId,
          createdAt: options.createdAt,
          taskId: options.taskPacket.id,
          ...result.recommendation,
        });
      }
    } catch {
      // Fall back to task-derived spec.
    }
  }

  return planningSpecArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    taskId: options.taskPacket.id,
    goal: options.taskPacket.intent,
    constraints: options.taskPacket.contextFiles.map((path) => `Use context file: ${path}`),
    nonGoals: options.taskPacket.nonGoals,
    acceptanceCriteria: options.taskPacket.acceptanceCriteria,
    assumptionsResolved:
      options.interview?.rounds.flatMap((round) =>
        round.answer ? [`${round.question} ${round.answer}`] : [],
      ) ?? [],
    assumptionLedger: options.interview?.assumptions ?? [],
    repoEvidence: [
      `Task source: ${options.taskPacket.source.kind} (${options.taskPacket.source.path})`,
      ...(options.taskPacket.targetArtifactPath
        ? [`Target artifact path: ${options.taskPacket.targetArtifactPath}`]
        : []),
    ],
    openRisks: options.taskPacket.risks,
  });
}

export async function writePlanningInterviewArtifacts(options: {
  depth: PlanningDepthArtifact;
  interview?: PlanningInterviewArtifact;
  projectRoot: string;
  runId: string;
  spec?: PlanningSpecArtifact;
}): Promise<void> {
  const runPaths = new RunStore(options.projectRoot).getRunPaths(options.runId);
  await writeJsonFile(runPaths.planningDepthPath, options.depth);
  if (options.interview) {
    await writeJsonFile(runPaths.planningInterviewPath, options.interview);
  }
  if (options.spec) {
    await writeJsonFile(runPaths.planningSpecPath, options.spec);
    await writeTextFileAtomically(
      runPaths.planningSpecMarkdownPath,
      renderPlanningSpec(options.spec),
    );
  }
}

function buildFallbackQuestion(taskPacket: MaterializedTaskPacket): {
  question: string;
  perspective: string;
  expectedAnswerShape: string;
} {
  return {
    question: `What concrete result, scope boundary, and success criteria should the plan preserve for "${taskPacket.title}"?`,
    perspective: "result-contract",
    expectedAnswerShape:
      "State the desired outcome, any non-goals, and how Oraculum should judge success.",
  };
}

function renderPlanningSpec(spec: PlanningSpecArtifact): string {
  return [
    "# Planning Spec",
    "",
    `- Run: ${spec.runId}`,
    `- Created: ${spec.createdAt}`,
    `- Task: ${spec.taskId}`,
    "",
    "## Goal",
    "",
    spec.goal,
    "",
    "## Acceptance Criteria",
    "",
    ...(spec.acceptanceCriteria.length > 0
      ? spec.acceptanceCriteria.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
    "## Assumption Ledger",
    "",
    ...(spec.assumptionLedger.length > 0
      ? spec.assumptionLedger.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
  ].join("\n");
}
