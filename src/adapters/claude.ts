import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
  buildAgentProfileRecommendationJsonSchema,
} from "../domain/profile.js";
import { consultationPreflightSchema } from "../domain/run.js";

import { buildAdapterResultBase, createAdapterPaths, executeAdapterCommand } from "./execution.js";
import {
  buildCandidatePrompt,
  buildClarifyFollowUpPrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "./prompt.js";
import {
  type AgentAdapter,
  type AgentClarifyFollowUpRequest,
  type AgentClarifyFollowUpResult,
  type AgentJudgeRecommendation,
  type AgentJudgeRequest,
  type AgentJudgeResult,
  type AgentPreflightRequest,
  type AgentPreflightResult,
  type AgentProfileRequest,
  type AgentProfileResult,
  type AgentRunRequest,
  type AgentRunResult,
  agentClarifyFollowUpResultSchema,
  agentJudgeRecommendationSchema,
  agentJudgeResultSchema,
  agentPreflightResultSchema,
  agentProfileResultSchema,
  agentRunResultSchema,
  buildAgentClarifyFollowUpJsonSchema,
  buildAgentPreflightJsonSchema,
} from "./types.js";

interface ClaudeAdapterOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude-code" as const;

  private readonly binaryPath: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.ORACULUM_CLAUDE_BIN ?? "claude";
    this.env = options.env;
    this.timeoutMs = options.timeoutMs;
  }

  async runCandidate(request: AgentRunRequest): Promise<AgentRunResult> {
    const prompt = buildCandidatePrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      prompt: "prompt.txt",
      stderr: "claude.stderr.txt",
      stdout: "claude.stdout.txt",
    });

    const execution = await executeAdapterCommand({
      args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
      binaryPath: this.binaryPath,
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      stdoutKind: "stdout",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        execution.subprocessResult.stdout,
        "Claude candidate execution finished.",
      ),
    });
  }

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    const prompt = buildWinnerSelectionPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      prompt: "winner-judge.prompt.txt",
      stderr: "winner-judge.stderr.txt",
      stdout: "winner-judge.stdout.txt",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildWinnerRecommendationSchema()),
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      stdoutKind: "stdout",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentJudgeResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        execution.subprocessResult.stdout,
        "Claude winner selection finished.",
      ),
      recommendation: extractRecommendation(execution.subprocessResult.stdout),
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    const prompt = buildPreflightPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      prompt: "preflight-judge.prompt.txt",
      stderr: "preflight-judge.stderr.txt",
      stdout: "preflight-judge.stdout.txt",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentPreflightJsonSchema()),
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      stdoutKind: "stdout",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentPreflightResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        execution.subprocessResult.stdout,
        "Claude preflight readiness finished.",
      ),
      recommendation: extractPreflightRecommendation(execution.subprocessResult.stdout),
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    const prompt = buildClarifyFollowUpPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      prompt: "clarify-follow-up.prompt.txt",
      stderr: "clarify-follow-up.stderr.txt",
      stdout: "clarify-follow-up.stdout.txt",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentClarifyFollowUpJsonSchema()),
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      stdoutKind: "stdout",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentClarifyFollowUpResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        execution.subprocessResult.stdout,
        "Claude clarify follow-up finished.",
      ),
      recommendation: extractClarifyFollowUpRecommendation(execution.subprocessResult.stdout),
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    const prompt = buildProfileSelectionPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      prompt: "profile-judge.prompt.txt",
      stderr: "profile-judge.stderr.txt",
      stdout: "profile-judge.stdout.txt",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentProfileRecommendationJsonSchema()),
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      stdoutKind: "stdout",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentProfileResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        execution.subprocessResult.stdout,
        "Claude profile selection finished.",
      ),
      recommendation: extractProfileRecommendation(execution.subprocessResult.stdout),
    });
  }
}

function summarizeAgentOutput(stdout: string, fallback: string): string {
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

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractRecommendation(stdout: string): AgentJudgeRecommendation | undefined {
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

function extractProfileRecommendation(stdout: string): AgentProfileRecommendation | undefined {
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

function looksLikeProfileRecommendation(value: Record<string, unknown>): boolean {
  const hasProfileId = "profileId" in value || "validationProfileId" in value;
  const hasSummary = "summary" in value || "validationSummary" in value;
  const hasValidationGaps = "missingCapabilities" in value || "validationGaps" in value;
  return (
    hasProfileId &&
    hasSummary &&
    hasValidationGaps &&
    "confidence" in value &&
    "candidateCount" in value &&
    "strategyIds" in value &&
    "selectedCommandIds" in value
  );
}

function extractPreflightRecommendation(stdout: string) {
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

function extractClarifyFollowUpRecommendation(stdout: string) {
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

function buildWinnerRecommendationSchema(): Record<string, unknown> {
  const judgingCriteriaProperty = {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
    },
    minItems: 1,
    maxItems: 5,
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["select", "abstain"],
      },
      candidateId: { type: "string", minLength: 1 },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string", minLength: 1 },
      judgingCriteria: judgingCriteriaProperty,
    },
    required: ["decision", "confidence", "summary"],
  };
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
