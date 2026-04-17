import type { z } from "zod";

import { agentJudgeResultSchema } from "../../../src/adapters/types.js";
import {
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../../../src/core/paths.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../../../src/services/finalist-judge.js";

import { writeJsonArtifact } from "../fs.js";

import { ensureRunReportsDir } from "./core.js";

export async function writeWinnerSelection(
  cwd: string,
  runId: string,
  value: z.input<typeof agentJudgeResultSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getWinnerSelectionPath(cwd, runId), agentJudgeResultSchema.parse(value));
}

export async function writeAbstainingWinnerSelection(
  cwd: string,
  runId: string,
  overrides: Partial<z.input<typeof agentJudgeResultSchema>> = {},
): Promise<void> {
  await writeWinnerSelection(cwd, runId, {
    runId,
    adapter: "codex",
    status: "completed",
    startedAt: "2026-04-05T00:00:00.000Z",
    completedAt: "2026-04-05T00:00:01.000Z",
    exitCode: 0,
    summary: "Judge abstained because the finalists remain too close.",
    recommendation: {
      decision: "abstain",
      confidence: "medium",
      summary: "The finalists remain too close to recommend safely.",
    },
    artifacts: [],
    ...overrides,
  });
}

export async function writeSelectedWinnerSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "codex" | "claude-code";
    candidateId?: string;
    confidence?: "low" | "medium" | "high";
    recommendationSummary?: string;
    resultSummary?: string;
    judgingCriteria?: string[];
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const candidateId = options.candidateId ?? "cand-01";
  const confidence = options.confidence ?? "medium";
  await writeWinnerSelection(cwd, runId, {
    runId,
    adapter: options.adapter ?? "codex",
    status: "completed",
    startedAt: options.startedAt ?? "2026-04-05T00:00:00.000Z",
    completedAt: options.completedAt ?? "2026-04-05T00:00:01.000Z",
    exitCode: 0,
    summary: options.resultSummary ?? `${candidateId} is the recommended survivor.`,
    recommendation: {
      decision: "select",
      candidateId,
      confidence,
      summary: options.recommendationSummary ?? `${candidateId} is the recommended survivor.`,
      ...(options.judgingCriteria?.length ? { judgingCriteria: options.judgingCriteria } : {}),
    },
    artifacts: [],
  });
}

export async function writeSecondOpinionWinnerSelection(
  cwd: string,
  runId: string,
  value: z.input<typeof secondOpinionWinnerSelectionArtifactSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getSecondOpinionWinnerSelectionPath(cwd, runId),
    secondOpinionWinnerSelectionArtifactSchema.parse(value),
  );
}

export async function writeDisagreeingSecondOpinionSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "claude-code" | "codex";
    triggerKinds?: z.input<typeof secondOpinionWinnerSelectionArtifactSchema.shape.triggerKinds>;
    triggerReasons?: string[];
    primaryCandidateId?: string;
    primaryConfidence?: "low" | "medium" | "high";
    primarySummary?: string;
    resultConfidence?: "low" | "medium" | "high";
    resultSummary?: string;
    resultRunnerSummary?: string;
    advisorySummary?: string;
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const primaryCandidateId = options.primaryCandidateId ?? "cand-01";
  const primaryConfidence = options.primaryConfidence ?? "medium";
  await writeSecondOpinionWinnerSelection(cwd, runId, {
    runId,
    advisoryOnly: true,
    adapter: options.adapter ?? "claude-code",
    triggerKinds: options.triggerKinds ?? ["low-confidence"],
    triggerReasons: options.triggerReasons ?? [
      "Primary finalist recommendation is low-confidence.",
    ],
    primaryRecommendation: {
      source: "llm-judge",
      decision: "select",
      candidateId: primaryCandidateId,
      confidence: primaryConfidence,
      summary: options.primarySummary ?? `${primaryCandidateId} is the recommended survivor.`,
    },
    result: {
      runId,
      adapter: options.adapter ?? "claude-code",
      status: "completed",
      startedAt: options.startedAt ?? "2026-04-05T00:00:02.000Z",
      completedAt: options.completedAt ?? "2026-04-05T00:00:03.000Z",
      exitCode: 0,
      summary: options.resultRunnerSummary ?? "Second-opinion judge abstained.",
      recommendation: {
        decision: "abstain",
        confidence: options.resultConfidence ?? "medium",
        summary:
          options.resultSummary ?? "The evidence is still too weak to recommend a finalist safely.",
      },
      artifacts: [],
    },
    agreement: "disagrees-select-vs-abstain",
    advisorySummary:
      options.advisorySummary ??
      "Second-opinion judge abstained, while the primary path selected a finalist.",
  });
}

export async function writeUnavailableSecondOpinionSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "claude-code" | "codex";
    triggerKinds?: z.input<typeof secondOpinionWinnerSelectionArtifactSchema.shape.triggerKinds>;
    triggerReasons?: string[];
    primaryCandidateId?: string;
    primaryConfidence?: "low" | "medium" | "high";
    primarySummary?: string;
    resultSummary?: string;
    advisorySummary?: string;
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const primaryCandidateId = options.primaryCandidateId ?? "cand-01";
  const primaryConfidence = options.primaryConfidence ?? "medium";
  await writeSecondOpinionWinnerSelection(cwd, runId, {
    runId,
    advisoryOnly: true,
    adapter: options.adapter ?? "claude-code",
    triggerKinds: options.triggerKinds ?? ["low-confidence"],
    triggerReasons: options.triggerReasons ?? [
      "Primary finalist recommendation is low-confidence.",
    ],
    primaryRecommendation: {
      source: "llm-judge",
      decision: "select",
      candidateId: primaryCandidateId,
      confidence: primaryConfidence,
      summary: options.primarySummary ?? `${primaryCandidateId} is the recommended survivor.`,
    },
    result: {
      runId,
      adapter: options.adapter ?? "claude-code",
      status: "failed",
      startedAt: options.startedAt ?? "2026-04-05T00:00:02.000Z",
      completedAt: options.completedAt ?? "2026-04-05T00:00:03.000Z",
      exitCode: 1,
      summary: options.resultSummary ?? "Second-opinion judge was unavailable.",
      artifacts: [],
    },
    agreement: "unavailable",
    advisorySummary:
      options.advisorySummary ??
      "Second-opinion judge was unavailable, so manual review is still required.",
  });
}
