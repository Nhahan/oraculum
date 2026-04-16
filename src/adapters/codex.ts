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

interface CodexAdapterOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex" as const;

  private readonly binaryPath: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: CodexAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.ORACULUM_CODEX_BIN ?? "codex";
    this.env = options.env;
    this.timeoutMs = options.timeoutMs;
  }

  async runCandidate(request: AgentRunRequest): Promise<AgentRunResult> {
    const prompt = buildCandidatePrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      finalMessage: "codex.final-message.txt",
      prompt: "prompt.txt",
      stderr: "codex.stderr.txt",
      stdout: "codex.stdout.jsonl",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "workspace-write",
        "--skip-git-repo-check",
        "--json",
        "-o",
        paths.finalMessage,
      ],
      binaryPath: this.binaryPath,
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
      stdoutKind: "transcript",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(
        finalMessage ?? execution.subprocessResult.stdout,
        "Codex candidate execution finished.",
      ),
    });
  }

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    const prompt = buildWinnerSelectionPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      finalMessage: "winner-judge.final-message.txt",
      prompt: "winner-judge.prompt.txt",
      schema: "winner-judge.schema.json",
      stderr: "winner-judge.stderr.txt",
      stdout: "winner-judge.stdout.jsonl",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        paths.schema,
        "-o",
        paths.finalMessage,
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
      sidecarWrites: [
        {
          kind: "report",
          path: paths.schema,
          content: `${JSON.stringify(buildCodexWinnerRecommendationSchema(), null, 2)}\n`,
        },
      ],
      stdoutKind: "transcript",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);
    const judgeOutput = finalMessage ?? execution.subprocessResult.stdout;

    return agentJudgeResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(judgeOutput, "Codex winner selection finished."),
      recommendation: extractRecommendation(judgeOutput),
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    const prompt = buildPreflightPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      finalMessage: "preflight-judge.final-message.txt",
      prompt: "preflight-judge.prompt.txt",
      schema: "preflight-judge.schema.json",
      stderr: "preflight-judge.stderr.txt",
      stdout: "preflight-judge.stdout.jsonl",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        paths.schema,
        "-o",
        paths.finalMessage,
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
      sidecarWrites: [
        {
          kind: "report",
          path: paths.schema,
          content: `${JSON.stringify(buildCodexPreflightJsonSchema(), null, 2)}\n`,
        },
      ],
      stdoutKind: "transcript",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);
    const judgeOutput = finalMessage ?? execution.subprocessResult.stdout;

    return agentPreflightResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(judgeOutput, "Codex preflight readiness finished."),
      recommendation: extractPreflightRecommendation(judgeOutput),
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    const prompt = buildClarifyFollowUpPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      finalMessage: "clarify-follow-up.final-message.txt",
      prompt: "clarify-follow-up.prompt.txt",
      schema: "clarify-follow-up.schema.json",
      stderr: "clarify-follow-up.stderr.txt",
      stdout: "clarify-follow-up.stdout.jsonl",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        paths.schema,
        "-o",
        paths.finalMessage,
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
      sidecarWrites: [
        {
          kind: "report",
          path: paths.schema,
          content: `${JSON.stringify(buildAgentClarifyFollowUpJsonSchema(), null, 2)}\n`,
        },
      ],
      stdoutKind: "transcript",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);
    const judgeOutput = finalMessage ?? execution.subprocessResult.stdout;

    return agentClarifyFollowUpResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(judgeOutput, "Codex clarify follow-up finished."),
      recommendation: extractClarifyFollowUpRecommendation(judgeOutput),
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    const prompt = buildProfileSelectionPrompt(request);
    const paths = createAdapterPaths(request.logDir, {
      finalMessage: "profile-judge.final-message.txt",
      prompt: "profile-judge.prompt.txt",
      schema: "profile-judge.schema.json",
      stderr: "profile-judge.stderr.txt",
      stdout: "profile-judge.stdout.jsonl",
    });

    const execution = await executeAdapterCommand({
      args: [
        "-a",
        "never",
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
        paths.schema,
        "-o",
        paths.finalMessage,
      ],
      binaryPath: this.binaryPath,
      cwd: request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      paths,
      prompt,
      readOptionalArtifacts: [{ kind: "report", path: paths.finalMessage }],
      sidecarWrites: [
        {
          kind: "report",
          path: paths.schema,
          content: `${JSON.stringify(buildCodexProfileRecommendationJsonSchema(), null, 2)}\n`,
        },
      ],
      stdoutKind: "transcript",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    const finalMessage = execution.optionalArtifactContents.get(paths.finalMessage);
    const judgeOutput = finalMessage ?? execution.subprocessResult.stdout;

    return agentProfileResultSchema.parse({
      runId: request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeAgentOutput(judgeOutput, "Codex profile selection finished."),
      recommendation: extractProfileRecommendation(judgeOutput),
    });
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
