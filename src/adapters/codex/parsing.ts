import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
} from "../../domain/profile.js";
import {
  candidateSpecContentSchema,
  candidateSpecSelectionRecommendationSchema,
  consultationPreflightSchema,
} from "../../domain/run.js";

import {
  type AgentJudgeRecommendation,
  agentClarifyFollowUpResultSchema,
  agentJudgeRecommendationSchema,
  agentPlanConsensusDraftResultSchema,
  agentPlanConsensusReviewResultSchema,
  agentPlanningDepthResultSchema,
  agentPlanningQuestionResultSchema,
  agentPlanningScoreResultSchema,
  agentPlanningSpecResultSchema,
  agentPlanReviewResultSchema,
} from "../types.js";

export function summarizeCodexOutput(output: string, fallback: string): string {
  const trimmed = output.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
}

export function extractCodexRecommendation(output: string): AgentJudgeRecommendation | undefined {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentJudgeRecommendationSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexProfileRecommendation(
  output: string,
): AgentProfileRecommendation | undefined {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentProfileRecommendationSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPreflightRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return consultationPreflightSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexClarifyFollowUpRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentClarifyFollowUpResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanReviewRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanReviewResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexCandidateSpecRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return candidateSpecContentSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexSpecSelectionRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return candidateSpecSelectionRecommendationSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanningDepthRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanningDepthResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanningQuestionRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanningQuestionResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanningScoreRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanningScoreResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanningSpecRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanningSpecResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanConsensusDraftRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanConsensusDraftResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

export function extractCodexPlanConsensusReviewRecommendation(output: string) {
  const parsed = extractJsonObject(output);
  if (!parsed) {
    return undefined;
  }

  try {
    return agentPlanConsensusReviewResultSchema.shape.recommendation.parse(parsed);
  } catch {
    return undefined;
  }
}

function extractJsonObject(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to JSONL parsing.
  }

  const lines = trimmed.split(/\r?\n/u).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore malformed JSONL events and keep scanning upward.
    }
  }

  return undefined;
}
