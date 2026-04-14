import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess } from "../core/subprocess.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
  buildAgentProfileRecommendationJsonSchema,
} from "../domain/profile.js";
import { consultationPreflightSchema } from "../domain/run.js";

import { shouldUseWindowsShell } from "./platform.js";
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
  private readonly timeoutMs: number;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.ORACULUM_CLAUDE_BIN ?? "claude";
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  }

  async runCandidate(request: AgentRunRequest): Promise<AgentRunResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildCandidatePrompt(request);
    const promptPath = join(request.logDir, "prompt.txt");
    const stdoutPath = join(request.logDir, "claude.stdout.txt");
    const stderrPath = join(request.logDir, "claude.stderr.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(result.stdout, "Claude candidate execution finished."),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "stdout", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
      ],
    });
  }

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildWinnerSelectionPrompt(request);
    const promptPath = join(request.logDir, "winner-judge.prompt.txt");
    const stdoutPath = join(request.logDir, "winner-judge.stdout.txt");
    const stderrPath = join(request.logDir, "winner-judge.stderr.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildWinnerRecommendationSchema()),
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    return agentJudgeResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(result.stdout, "Claude winner selection finished."),
      recommendation: extractRecommendation(result.stdout),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "stdout", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
      ],
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildPreflightPrompt(request);
    const promptPath = join(request.logDir, "preflight-judge.prompt.txt");
    const stdoutPath = join(request.logDir, "preflight-judge.stdout.txt");
    const stderrPath = join(request.logDir, "preflight-judge.stderr.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentPreflightJsonSchema()),
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    return agentPreflightResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(result.stdout, "Claude preflight readiness finished."),
      recommendation: extractPreflightRecommendation(result.stdout),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "stdout", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
      ],
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildClarifyFollowUpPrompt(request);
    const promptPath = join(request.logDir, "clarify-follow-up.prompt.txt");
    const stdoutPath = join(request.logDir, "clarify-follow-up.stdout.txt");
    const stderrPath = join(request.logDir, "clarify-follow-up.stderr.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentClarifyFollowUpJsonSchema()),
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    return agentClarifyFollowUpResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(result.stdout, "Claude clarify follow-up finished."),
      recommendation: extractClarifyFollowUpRecommendation(result.stdout),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "stdout", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
      ],
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildProfileSelectionPrompt(request);
    const promptPath = join(request.logDir, "profile-judge.prompt.txt");
    const stdoutPath = join(request.logDir, "profile-judge.stdout.txt");
    const stderrPath = join(request.logDir, "profile-judge.stderr.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "plan",
        "--json-schema",
        JSON.stringify(buildAgentProfileRecommendationJsonSchema()),
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    return agentProfileResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(result.stdout, "Claude profile selection finished."),
      recommendation: extractProfileRecommendation(result.stdout),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "stdout", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
      ],
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
