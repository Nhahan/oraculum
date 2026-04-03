import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess } from "../core/subprocess.js";

import { buildCandidatePrompt } from "./prompt.js";
import {
  type AgentAdapter,
  type AgentRunRequest,
  type AgentRunResult,
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
      args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions", prompt],
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
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
