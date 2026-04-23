import { readdir, readFile } from "node:fs/promises";

import type { AgentAdapter } from "../../adapters/types.js";
import { getRunsDir } from "../../core/paths.js";
import {
  type PlanningDepthArtifact,
  type PlanningInterviewArtifact,
  type PlanningSpecArtifact,
  planningDepthArtifactSchema,
  planningInterviewArtifactSchema,
  planningSpecArtifactSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import type { ProjectConfigLayers } from "../project.js";
import { pathExists, writeJsonFile, writeTextFileAtomically } from "../project.js";
import { RunStore } from "../run-store.js";

export interface PlanningCaps {
  explicitPlanMaxInterviewRounds: number;
  explicitPlanMaxConsensusRevisions: number;
  explicitPlanModelCallTimeoutMs: number;
  consultLiteMaxPlanningCalls: number;
}

export const DEFAULT_PLANNING_CAPS: PlanningCaps = {
  explicitPlanMaxInterviewRounds: 8,
  explicitPlanMaxConsensusRevisions: 3,
  explicitPlanModelCallTimeoutMs: 120_000,
  consultLiteMaxPlanningCalls: 1,
};

export function resolvePlanningCaps(configLayers: ProjectConfigLayers): PlanningCaps {
  return {
    explicitPlanMaxInterviewRounds:
      configLayers.advanced?.planning?.explicitPlanMaxInterviewRounds ??
      DEFAULT_PLANNING_CAPS.explicitPlanMaxInterviewRounds,
    explicitPlanMaxConsensusRevisions:
      configLayers.advanced?.planning?.explicitPlanMaxConsensusRevisions ??
      DEFAULT_PLANNING_CAPS.explicitPlanMaxConsensusRevisions,
    explicitPlanModelCallTimeoutMs:
      configLayers.advanced?.planning?.explicitPlanModelCallTimeoutMs ??
      DEFAULT_PLANNING_CAPS.explicitPlanModelCallTimeoutMs,
    consultLiteMaxPlanningCalls:
      configLayers.advanced?.planning?.consultLiteMaxPlanningCalls ??
      DEFAULT_PLANNING_CAPS.consultLiteMaxPlanningCalls,
  };
}

export async function findActivePlanningInterview(
  projectRoot: string,
): Promise<PlanningInterviewArtifact | undefined> {
  const runsDir = getRunsDir(projectRoot);
  if (!(await pathExists(runsDir))) {
    return undefined;
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const runIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const runId of runIds) {
    const interviewPath = new RunStore(projectRoot).getRunPaths(runId).planningInterviewPath;
    if (!(await pathExists(interviewPath))) {
      continue;
    }

    const parsed = planningInterviewArtifactSchema.safeParse(
      JSON.parse(await readFile(interviewPath, "utf8")) as unknown,
    );
    if (parsed.success && parsed.data.status === "needs-clarification") {
      return parsed.data;
    }
  }

  return undefined;
}

export async function classifyPlanningContinuation(options: {
  activeInterview: PlanningInterviewArtifact | undefined;
  adapter: AgentAdapter | undefined;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanningInterviewArtifact | undefined> {
  if (!options.activeInterview || !options.adapter?.classifyPlanningContinuation) {
    return undefined;
  }

  try {
    const result = await options.adapter.classifyPlanningContinuation({
      activeInterview: options.activeInterview,
      logDir: options.reportsDir,
      projectRoot: options.projectRoot,
      runId: options.runId,
      taskPacket: options.taskPacket,
    });
    return result.status === "completed" && result.recommendation?.classification === "continuation"
      ? options.activeInterview
      : undefined;
  } catch {
    return undefined;
  }
}

export async function recommendPlanningDepthArtifact(options: {
  adapter: AgentAdapter | undefined;
  caps: PlanningCaps;
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
        maxConsensusRevisions: options.caps.explicitPlanMaxConsensusRevisions,
        maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        return planningDepthArtifactSchema.parse({
          runId: options.runId,
          createdAt: options.createdAt,
          ...result.recommendation,
          estimatedInterviewRounds: Math.min(
            result.recommendation.estimatedInterviewRounds,
            options.caps.explicitPlanMaxInterviewRounds,
          ),
          maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
          maxConsensusRevisions: options.caps.explicitPlanMaxConsensusRevisions,
        });
      }
    } catch {
      // Fall back to a conservative no-interview plan when the runtime cannot decide depth.
    }
  }

  return planningDepthArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    depth: "skip-interview",
    readiness: "ready",
    confidence: "low",
    summary: "Planning depth runtime unavailable; proceeding with the existing task contract.",
    reasons: ["No structured planning depth recommendation was available."],
    estimatedInterviewRounds: 0,
    consensusReviewDepth: "standard",
    maxInterviewRounds: options.caps.explicitPlanMaxInterviewRounds,
    maxConsensusRevisions: options.caps.explicitPlanMaxConsensusRevisions,
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
  const nextRoundNumber = (options.priorInterview?.rounds.length ?? 0) + 1;
  const fallbackQuestion = buildFallbackQuestion(options.taskPacket);
  let question: {
    question: string;
    perspective: string;
    expectedAnswerShape?: string | undefined;
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
        question = result.recommendation;
      }
    } catch {
      // Keep fallback question.
    }
  }

  return planningInterviewArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    status: "needs-clarification",
    taskId: options.taskPacket.id,
    ...(options.priorInterview ? { sourceRunId: options.priorInterview.runId } : {}),
    depth: options.depth.depth,
    rounds: [
      ...(options.priorInterview?.rounds ?? []),
      {
        round: nextRoundNumber,
        question: question.question,
        perspective: question.perspective,
        ...(question.expectedAnswerShape
          ? { expectedAnswerShape: question.expectedAnswerShape }
          : {}),
      },
    ],
    nextQuestion: question.question,
  });
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
  const readyForSpec = scoredRound.readyForSpec || capReached;

  return planningInterviewArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    status: readyForSpec ? "ready-for-spec" : "needs-clarification",
    taskId: options.taskPacket.id,
    sourceRunId: options.priorInterview.runId,
    depth: options.depth.depth,
    rounds,
    clarityScore,
    weakestDimension: scoredRound.weakestDimension,
    assumptions: scoredRound.assumptions,
    ontologySnapshots: rounds.flatMap((round) =>
      round.ontologySnapshot ? [round.ontologySnapshot] : [],
    ),
    ...(!readyForSpec ? { nextQuestion: lastRound.question } : {}),
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
  expectedAnswerShape?: string | undefined;
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
