import { mkdir, writeFile } from "node:fs/promises";

import type { AgentAdapter, AgentJudgeResult, AgentRunResult } from "../adapters/types.js";
import { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getWinnerJudgeLogsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import type { OracleVerdict } from "../domain/oracle.js";
import {
  type CandidateManifest,
  type RunRecommendation,
  runRecommendationSchema,
} from "../domain/run.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { buildEnrichedFinalistSummaries } from "./finalist-insights.js";
import { writeJsonFile } from "./project.js";

interface RecommendWinnerOptions {
  adapter: AgentAdapter;
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  projectRoot: string;
  runId: string;
  taskPacket: unknown;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}

export async function recommendWinnerWithJudge(
  options: RecommendWinnerOptions,
): Promise<RunRecommendation | undefined> {
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    verdictsByCandidate: options.verdictsByCandidate,
  });
  if (finalists.length === 0) {
    return undefined;
  }

  const taskPacket = materializedTaskPacketSchema.parse(options.taskPacket);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const logDir = getWinnerJudgeLogsDir(projectRoot, options.runId);
  await mkdir(logDir, { recursive: true });
  const persistedResultPath = getWinnerSelectionPath(projectRoot, options.runId);

  let judgeResult: AgentJudgeResult;
  try {
    judgeResult = agentJudgeResultSchema.parse(
      await options.adapter.recommendWinner({
        runId: options.runId,
        projectRoot,
        logDir,
        taskPacket,
        finalists,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJudgeWarning(
      persistedResultPath,
      `Winner selection judge failed to start or complete: ${message}`,
    );
    return undefined;
  }

  await writeJsonFile(persistedResultPath, judgeResult);

  if (judgeResult.status !== "completed") {
    await writeJudgeWarning(
      persistedResultPath,
      `Winner selection judge status was "${judgeResult.status}", so the deterministic fallback policy was used instead.`,
    );
    return undefined;
  }

  const recommendation = judgeResult.recommendation;
  if (!recommendation) {
    await writeJudgeWarning(
      persistedResultPath,
      "Winner selection judge did not return a structured recommendation, so the deterministic fallback policy was used instead.",
    );
    return undefined;
  }

  const matchingFinalist = finalists.find(
    (finalist) => finalist.candidateId === recommendation.candidateId,
  );
  if (!matchingFinalist) {
    await writeJudgeWarning(
      persistedResultPath,
      `Judge returned unknown candidate "${recommendation.candidateId}".`,
    );
    return undefined;
  }

  return runRecommendationSchema.parse({
    candidateId: recommendation.candidateId,
    confidence: recommendation.confidence,
    summary: recommendation.summary,
    source: "llm-judge",
  });
}

async function writeJudgeWarning(resultPath: string, message: string): Promise<void> {
  await writeFile(`${resultPath}.warning.txt`, `${message}\n`, "utf8");
}
