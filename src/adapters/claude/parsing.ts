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
  agentPlanConsensusContinuationResultSchema,
  agentPlanConsensusDraftResultSchema,
  agentPlanConsensusReviewResultSchema,
  agentPlanningContinuationResultSchema,
  agentPlanningDepthResultSchema,
  agentPlanningQuestionResultSchema,
  agentPlanningScoreResultSchema,
  agentPlanningSpecResultSchema,
  agentPlanReviewResultSchema,
} from "../types.js";

export function summarizeClaudeOutput(stdout: string, fallback: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate =
      firstString(parsed.result) ??
      firstString(parsed.summary) ??
      firstString(parsed.content) ??
      firstString(parsed.message);
    if (candidate) {
      return candidate.slice(0, 500);
    }
  } catch {
    // Keep raw stdout fallback when output is not valid JSON.
  }

  return trimmed.slice(0, 500);
}

export function extractClaudeRecommendation(stdout: string): AgentJudgeRecommendation | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const payload = pickObject(parsed);
    if (!payload) {
      return undefined;
    }

    return agentJudgeRecommendationSchema.parse(payload);
  } catch {
    return undefined;
  }
}

export function extractClaudeProfileRecommendation(
  stdout: string,
): AgentProfileRecommendation | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (looksLikeProfileRecommendation(parsed)) {
      const topLevel = agentProfileRecommendationSchema.safeParse(parsed);
      if (topLevel.success) {
        return topLevel.data;
      }
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if (looksLikeProfileRecommendation(nested)) {
          const recommendation = agentProfileRecommendationSchema.safeParse(nested);
          if (recommendation.success) {
            return recommendation.data;
          }
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudePreflightRecommendation(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      "decision" in parsed &&
      "summary" in parsed &&
      "confidence" in parsed &&
      "researchPosture" in parsed
    ) {
      return consultationPreflightSchema.parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if (
          "decision" in nested &&
          "summary" in nested &&
          "confidence" in nested &&
          "researchPosture" in nested
        ) {
          return consultationPreflightSchema.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudeClarifyFollowUpRecommendation(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      "summary" in parsed &&
      "keyQuestion" in parsed &&
      "missingResultContract" in parsed &&
      "missingJudgingBasis" in parsed
    ) {
      return agentClarifyFollowUpResultSchema.shape.recommendation.parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if (
          "summary" in nested &&
          "keyQuestion" in nested &&
          "missingResultContract" in nested &&
          "missingJudgingBasis" in nested
        ) {
          return agentClarifyFollowUpResultSchema.shape.recommendation.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudePlanReviewRecommendation(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if ("status" in parsed && "summary" in parsed && "nextAction" in parsed) {
      return agentPlanReviewResultSchema.shape.recommendation.parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ("status" in nested && "summary" in nested && "nextAction" in nested) {
          return agentPlanReviewResultSchema.shape.recommendation.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudeCandidateSpecRecommendation(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if ("summary" in parsed && "approach" in parsed && "keyChanges" in parsed) {
      return candidateSpecContentSchema.parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ("summary" in nested && "approach" in nested && "keyChanges" in nested) {
          return candidateSpecContentSchema.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudeSpecSelectionRecommendation(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if ("rankedCandidateIds" in parsed && "summary" in parsed) {
      return candidateSpecSelectionRecommendationSchema.parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ("rankedCandidateIds" in nested && "summary" in nested) {
          return candidateSpecSelectionRecommendationSchema.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function extractClaudePlanningDepthRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["readiness"], (value) =>
    agentPlanningDepthResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanningContinuationRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["classification", "confidence"], (value) =>
    agentPlanningContinuationResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanConsensusContinuationRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["classification", "confidence"], (value) =>
    agentPlanConsensusContinuationResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanningQuestionRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["question", "perspective"], (value) =>
    agentPlanningQuestionResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanningScoreRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["clarityScore", "readyForSpec"], (value) =>
    agentPlanningScoreResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanningSpecRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["goal", "acceptanceCriteria"], (value) =>
    agentPlanningSpecResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanConsensusDraftRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["summary", "selectedOption"], (value) =>
    agentPlanConsensusDraftResultSchema.shape.recommendation.parse(value),
  );
}

export function extractClaudePlanConsensusReviewRecommendation(stdout: string) {
  return extractClaudeNestedRecommendation(stdout, ["verdict", "summary"], (value) =>
    agentPlanConsensusReviewResultSchema.shape.recommendation.parse(value),
  );
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function looksLikeProfileRecommendation(value: Record<string, unknown>): boolean {
  return (
    "validationProfileId" in value &&
    "validationSummary" in value &&
    "validationGaps" in value &&
    "confidence" in value &&
    "candidateCount" in value &&
    "strategyIds" in value &&
    "selectedCommandIds" in value
  );
}

function pickObject(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  if (
    ("decision" in parsed || "candidateId" in parsed) &&
    "summary" in parsed &&
    "confidence" in parsed
  ) {
    return parsed;
  }

  for (const value of nestedObjects(parsed)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const objectValue = value as Record<string, unknown>;
      if (
        ("decision" in objectValue || "candidateId" in objectValue) &&
        "summary" in objectValue &&
        "confidence" in objectValue
      ) {
        return objectValue;
      }
    }
  }

  return undefined;
}

function nestedObjects(parsed: Record<string, unknown>): unknown[] {
  return [parsed.structured_output, parsed.result, parsed.content, parsed.message];
}

function extractClaudeNestedRecommendation<T>(
  stdout: string,
  keys: string[],
  parse: (value: Record<string, unknown>) => T,
): T | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (keys.every((key) => key in parsed)) {
      return parse(parsed);
    }

    for (const value of nestedObjects(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if (keys.every((key) => key in nested)) {
          return parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
