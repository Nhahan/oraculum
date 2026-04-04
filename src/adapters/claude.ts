import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess } from "../core/subprocess.js";

import { buildCandidatePrompt, buildWinnerSelectionPrompt } from "./prompt.js";
import {
  type AgentAdapter,
  type AgentJudgeRequest,
  type AgentJudgeResult,
  type AgentRunRequest,
  type AgentRunResult,
  agentJudgeResultSchema,
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
      args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
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

function extractRecommendation(
  stdout: string,
): { candidateId: string; confidence: "low" | "medium" | "high"; summary: string } | undefined {
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

    const candidateId = firstString(payload.candidateId);
    const confidence = firstConfidence(payload.confidence);
    const summary = firstString(payload.summary);
    if (!candidateId || !confidence || !summary) {
      return undefined;
    }

    return { candidateId, confidence, summary };
  } catch {
    return undefined;
  }
}

function pickObject(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  if ("candidateId" in parsed && "summary" in parsed && "confidence" in parsed) {
    return parsed;
  }

  const nested = [parsed.result, parsed.content, parsed.message];
  for (const value of nested) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const objectValue = value as Record<string, unknown>;
      if ("candidateId" in objectValue && "summary" in objectValue && "confidence" in objectValue) {
        return objectValue;
      }
    }
  }

  return undefined;
}

function firstConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
