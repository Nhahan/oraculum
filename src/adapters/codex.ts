import { mkdir, readFile, writeFile } from "node:fs/promises";
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
        "exec",
        "-s",
        "workspace-write",
        "--skip-git-repo-check",
        "--json",
        "-o",
        finalMessagePath,
      ],
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
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

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildWinnerSelectionPrompt(request);
    const promptPath = join(request.logDir, "winner-judge.prompt.txt");
    const schemaPath = join(request.logDir, "winner-judge.schema.json");
    const stdoutPath = join(request.logDir, "winner-judge.stdout.jsonl");
    const stderrPath = join(request.logDir, "winner-judge.stderr.txt");
    const finalMessagePath = join(request.logDir, "winner-judge.final-message.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");
    await writeFile(
      schemaPath,
      `${JSON.stringify(buildCodexWinnerRecommendationSchema(), null, 2)}\n`,
    );

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        schemaPath,
        "-o",
        finalMessagePath,
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    const finalMessage = await readOptionalFile(finalMessagePath);
    const judgeOutput = finalMessage ?? result.stdout;

    return agentJudgeResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(judgeOutput, "Codex winner selection finished."),
      recommendation: extractRecommendation(judgeOutput),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "report", path: schemaPath },
        { kind: "transcript", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
        ...(finalMessage ? [{ kind: "report" as const, path: finalMessagePath }] : []),
      ],
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildPreflightPrompt(request);
    const promptPath = join(request.logDir, "preflight-judge.prompt.txt");
    const schemaPath = join(request.logDir, "preflight-judge.schema.json");
    const stdoutPath = join(request.logDir, "preflight-judge.stdout.jsonl");
    const stderrPath = join(request.logDir, "preflight-judge.stderr.txt");
    const finalMessagePath = join(request.logDir, "preflight-judge.final-message.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");
    await writeFile(schemaPath, `${JSON.stringify(buildCodexPreflightJsonSchema(), null, 2)}\n`);

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        schemaPath,
        "-o",
        finalMessagePath,
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    const finalMessage = await readOptionalFile(finalMessagePath);
    const judgeOutput = finalMessage ?? result.stdout;

    return agentPreflightResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(judgeOutput, "Codex preflight readiness finished."),
      recommendation: extractPreflightRecommendation(judgeOutput),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "report", path: schemaPath },
        { kind: "transcript", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
        ...(finalMessage ? [{ kind: "report" as const, path: finalMessagePath }] : []),
      ],
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildClarifyFollowUpPrompt(request);
    const promptPath = join(request.logDir, "clarify-follow-up.prompt.txt");
    const schemaPath = join(request.logDir, "clarify-follow-up.schema.json");
    const stdoutPath = join(request.logDir, "clarify-follow-up.stdout.jsonl");
    const stderrPath = join(request.logDir, "clarify-follow-up.stderr.txt");
    const finalMessagePath = join(request.logDir, "clarify-follow-up.final-message.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");
    await writeFile(
      schemaPath,
      `${JSON.stringify(buildAgentClarifyFollowUpJsonSchema(), null, 2)}\n`,
    );

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        schemaPath,
        "-o",
        finalMessagePath,
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    const finalMessage = await readOptionalFile(finalMessagePath);
    const judgeOutput = finalMessage ?? result.stdout;

    return agentClarifyFollowUpResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(judgeOutput, "Codex clarify follow-up finished."),
      recommendation: extractClarifyFollowUpRecommendation(judgeOutput),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "report", path: schemaPath },
        { kind: "transcript", path: stdoutPath },
        { kind: "stderr", path: stderrPath },
        ...(finalMessage ? [{ kind: "report" as const, path: finalMessagePath }] : []),
      ],
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    await mkdir(request.logDir, { recursive: true });

    const prompt = buildProfileSelectionPrompt(request);
    const promptPath = join(request.logDir, "profile-judge.prompt.txt");
    const schemaPath = join(request.logDir, "profile-judge.schema.json");
    const stdoutPath = join(request.logDir, "profile-judge.stdout.jsonl");
    const stderrPath = join(request.logDir, "profile-judge.stderr.txt");
    const finalMessagePath = join(request.logDir, "profile-judge.final-message.txt");
    const startedAt = new Date().toISOString();

    await writeFile(promptPath, prompt, "utf8");
    await writeFile(
      schemaPath,
      `${JSON.stringify(buildCodexProfileRecommendationJsonSchema(), null, 2)}\n`,
    );

    const result = await runSubprocess({
      command: this.binaryPath,
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        schemaPath,
        "-o",
        finalMessagePath,
      ],
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      ...(shouldUseWindowsShell(this.binaryPath) ? { shell: true } : {}),
      stdin: prompt,
      timeoutMs: this.timeoutMs,
    });

    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");

    const finalMessage = await readOptionalFile(finalMessagePath);
    const judgeOutput = finalMessage ?? result.stdout;

    return agentProfileResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      summary: summarizeAgentOutput(judgeOutput, "Codex profile selection finished."),
      recommendation: extractProfileRecommendation(judgeOutput),
      artifacts: [
        { kind: "prompt", path: promptPath },
        { kind: "report", path: schemaPath },
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

function extractRecommendation(output: string): AgentJudgeRecommendation | undefined {
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

function extractProfileRecommendation(output: string): AgentProfileRecommendation | undefined {
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

function extractPreflightRecommendation(output: string) {
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

function extractClarifyFollowUpRecommendation(output: string) {
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

function buildCodexNullableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    anyOf: [schema, { type: "null" }],
  };
}

function buildCodexWinnerRecommendationSchema(): Record<string, unknown> {
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
      candidateId: buildCodexNullableSchema({ type: "string", minLength: 1 }),
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string", minLength: 1 },
      judgingCriteria: buildCodexNullableSchema(judgingCriteriaProperty),
    },
    required: ["decision", "candidateId", "confidence", "summary", "judgingCriteria"],
  };
}

function buildCodexPreflightJsonSchema(): Record<string, unknown> {
  const base = buildAgentPreflightJsonSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  return {
    ...base,
    properties: {
      ...base.properties,
      clarificationQuestion: buildCodexNullableSchema(base.properties.clarificationQuestion ?? {}),
      researchQuestion: buildCodexNullableSchema(base.properties.researchQuestion ?? {}),
    },
    required: Object.keys(base.properties),
  };
}

function buildCodexProfileRecommendationJsonSchema(): Record<string, unknown> {
  const base = buildAgentProfileRecommendationJsonSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  return {
    ...base,
    properties: {
      ...base.properties,
      profileId: buildCodexNullableSchema(base.properties.profileId ?? {}),
      summary: buildCodexNullableSchema(base.properties.summary ?? {}),
      missingCapabilities: buildCodexNullableSchema(base.properties.missingCapabilities ?? {}),
    },
    required: Object.keys(base.properties),
  };
}
