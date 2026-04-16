import type { AgentJudgeResult } from "../../adapters/types.js";
import { runRecommendationSchema } from "../../domain/run.js";

import { RunStore } from "../run-store.js";

import { runFinalistJudge, writeJudgeWarning } from "./runner.js";
import { buildJudgableFinalists, persistFinalistScorecards } from "./scorecards.js";
import type { RecommendWinnerOptions, WinnerJudgeOutcome } from "./shared.js";

export async function recommendWinnerWithJudge(
  options: RecommendWinnerOptions,
): Promise<WinnerJudgeOutcome> {
  const store = new RunStore(options.projectRoot);
  const projectRoot = store.projectRoot;
  const finalists = await buildJudgableFinalists({
    candidateResults: options.candidateResults,
    candidates: options.candidates,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    projectRoot,
    runId: options.runId,
    verdictsByCandidate: options.verdictsByCandidate,
    ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
  });
  if (finalists.length === 0) {
    return { fallbackAllowed: false };
  }

  const runPaths = store.getRunPaths(options.runId);
  await persistFinalistScorecards({
    finalists,
    projectRoot,
    runId: options.runId,
  });

  let judgeResult: AgentJudgeResult;
  try {
    judgeResult = await runFinalistJudge({
      adapter: options.adapter,
      ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
      finalists,
      logDir: runPaths.winnerJudgeLogsDir,
      projectRoot,
      runId: options.runId,
      taskPacket: options.taskPacket,
      ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJudgeWarning(
      runPaths.winnerSelectionPath,
      `Winner selection judge failed to start or complete: ${message}`,
    );
    return { fallbackAllowed: true };
  }

  await store.writeJsonArtifact(runPaths.winnerSelectionPath, judgeResult);

  if (judgeResult.status !== "completed") {
    await writeJudgeWarning(
      runPaths.winnerSelectionPath,
      `Winner selection judge status was "${judgeResult.status}", so the deterministic fallback policy was used instead.`,
    );
    return { fallbackAllowed: true, judgeResult };
  }

  const recommendation = judgeResult.recommendation;
  if (!recommendation) {
    await writeJudgeWarning(
      runPaths.winnerSelectionPath,
      "Winner selection judge did not return a structured recommendation, so the deterministic fallback policy was used instead.",
    );
    return { fallbackAllowed: true, judgeResult };
  }

  if (recommendation.decision === "abstain") {
    return { fallbackAllowed: false, judgeResult };
  }

  const matchingFinalist = finalists.find(
    (finalist) => finalist.candidateId === recommendation.candidateId,
  );
  if (!matchingFinalist) {
    await writeJudgeWarning(
      runPaths.winnerSelectionPath,
      `Judge returned unknown candidate "${recommendation.candidateId}".`,
    );
    return { fallbackAllowed: true, judgeResult };
  }

  return {
    fallbackAllowed: false,
    judgeResult,
    recommendation: runRecommendationSchema.parse({
      candidateId: recommendation.candidateId,
      confidence: recommendation.confidence,
      summary: recommendation.summary,
      source: "llm-judge",
    }),
  };
}
