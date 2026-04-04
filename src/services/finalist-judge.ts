import { mkdir, writeFile } from "node:fs/promises";

import type { AgentAdapter, AgentRunResult, FinalistSummary } from "../adapters/types.js";
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
  const finalists = buildFinalists(
    options.candidates,
    options.candidateResults,
    options.verdictsByCandidate,
  );
  if (finalists.length === 0) {
    return undefined;
  }

  const taskPacket = materializedTaskPacketSchema.parse(options.taskPacket);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const logDir = getWinnerJudgeLogsDir(projectRoot, options.runId);
  await mkdir(logDir, { recursive: true });

  const judgeResult = agentJudgeResultSchema.parse(
    await options.adapter.recommendWinner({
      runId: options.runId,
      projectRoot,
      logDir,
      taskPacket,
      finalists,
    }),
  );

  const persistedResultPath = getWinnerSelectionPath(projectRoot, options.runId);
  await writeJsonFile(persistedResultPath, judgeResult);

  const recommendation = judgeResult.recommendation;
  if (!recommendation) {
    return undefined;
  }

  const matchingFinalist = finalists.find(
    (finalist) => finalist.candidateId === recommendation.candidateId,
  );
  if (!matchingFinalist) {
    await writeFile(
      `${persistedResultPath}.warning.txt`,
      `Judge returned unknown candidate "${recommendation.candidateId}".\n`,
      "utf8",
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

function buildFinalists(
  candidates: CandidateManifest[],
  candidateResults: AgentRunResult[],
  verdictsByCandidate: Map<string, OracleVerdict[]>,
): FinalistSummary[] {
  const resultByCandidate = new Map(candidateResults.map((result) => [result.candidateId, result]));

  return candidates
    .filter((candidate) => candidate.status === "promoted")
    .map((candidate) => {
      const result = resultByCandidate.get(candidate.id);
      return {
        candidateId: candidate.id,
        strategyLabel: candidate.strategyLabel,
        summary: result?.summary ?? "No agent summary captured.",
        artifactKinds: result?.artifacts.map((artifact) => artifact.kind) ?? [],
        verdicts: (verdictsByCandidate.get(candidate.id) ?? []).map((verdict) => ({
          roundId: verdict.roundId,
          oracleId: verdict.oracleId,
          status: verdict.status,
          severity: verdict.severity,
          summary: verdict.summary,
        })),
      };
    });
}
