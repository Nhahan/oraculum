import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runSubprocess } from "../core/subprocess.js";

import { buildCandidatePrompt } from "./prompt.js";
import {
  type AgentAdapter,
  type AgentRunRequest,
  type AgentRunResult,
  agentRunResultSchema,
} from "./types.js";

interface CodexAdapterOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex" as const;

  private readonly binaryPath: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly timeoutMs: number;

  constructor(options: CodexAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.ORACULUM_CODEX_BIN ?? "codex";
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  }

  async runCandidate(request: AgentRunRequest): Promise<AgentRunResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildCandidatePrompt(request);
    const promptPath = join(request.logDir, "prompt.txt");
    const stdoutPath = join(request.logDir, "codex.stdout.jsonl");
    const stderrPath = join(request.logDir, "codex.stderr.txt");
    const finalMessagePath = join(request.logDir, "codex.final-message.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-a",
        "never",
        "-s",
        "workspace-write",
        "exec",
        "--skip-git-repo-check",
        "--json",
        "-o",
        finalMessagePath,
        prompt,
      ],
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    const finalMessage = await readOptionalFile(finalMessagePath);

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(
        finalMessage ?? result.stdout,
        "Codex candidate execution finished.",
      ),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "transcript", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
        ...(finalMessage ? [{ kind: "report" as const, path: finalMessagePath }] : []),
      ],
    });
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function summarizeAgentOutput(output: string, fallback: string): string {
  const trimmed = output.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
}
