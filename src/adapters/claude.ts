import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess } from "../core/subprocess.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
} from "../domain/profile.js";

import { shouldUseWindowsShell } from "./platform.js";
import {
  buildCandidatePrompt,
  buildProfileSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "./prompt.js";
import {
  type AgentAdapter,
  type AgentJudgeRecommendation,
  type AgentJudgeRequest,
  type AgentJudgeResult,
  type AgentProfileRequest,
  type AgentProfileResult,
  type AgentRunRequest,
  type AgentRunResult,
  agentJudgeRecommendationSchema,
  agentJudgeResultSchema,
  agentProfileResultSchema,
  agentRunResultSchema,
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
        JSON.stringify(buildProfileRecommendationSchema()),
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
    if (
      "profileId" in parsed &&
      "summary" in parsed &&
      "confidence" in parsed &&
      "candidateCount" in parsed
    ) {
      return agentProfileRecommendationSchema.parse(parsed);
    }

    for (const value of [parsed.result, parsed.content, parsed.message]) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if (
          "profileId" in nested &&
          "summary" in nested &&
          "confidence" in nested &&
          "candidateCount" in nested
        ) {
          return agentProfileRecommendationSchema.parse(nested);
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildProfileRecommendationSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      profileId: {
        type: "string",
        enum: ["library", "frontend", "migration"],
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string", minLength: 1 },
      candidateCount: { type: "integer", minimum: 1, maximum: 16 },
      strategyIds: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "string",
          enum: ["minimal-change", "safety-first", "test-amplified", "structural-refactor"],
        },
      },
      selectedCommandIds: {
        type: "array",
        items: { type: "string" },
      },
      missingCapabilities: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "profileId",
      "confidence",
      "summary",
      "candidateCount",
      "strategyIds",
      "selectedCommandIds",
      "missingCapabilities",
    ],
  };
}

function buildWinnerRecommendationSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: { type: "string", const: "select" },
          candidateId: { type: "string", minLength: 1 },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          summary: { type: "string", minLength: 1 },
        },
        required: ["decision", "candidateId", "confidence", "summary"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: { type: "string", const: "abstain" },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          summary: { type: "string", minLength: 1 },
        },
        required: ["decision", "confidence", "summary"],
      },
    ],
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

  const nested = [parsed.result, parsed.content, parsed.message];
  for (const value of nested) {
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
