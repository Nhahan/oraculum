import { buildAdapterResultBase } from "../execution.js";
import {
  buildCandidatePrompt,
  buildClarifyFollowUpPrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "../prompt.js";
import {
  type AgentAdapter,
  type AgentClarifyFollowUpRequest,
  type AgentClarifyFollowUpResult,
  type AgentJudgeRequest,
  type AgentJudgeResult,
  type AgentPreflightRequest,
  type AgentPreflightResult,
  type AgentProfileRequest,
  type AgentProfileResult,
  type AgentRunRequest,
  type AgentRunResult,
  agentClarifyFollowUpResultSchema,
  agentJudgeResultSchema,
  agentPreflightResultSchema,
  agentProfileResultSchema,
  agentRunResultSchema,
} from "../types.js";
import {
  extractCodexClarifyFollowUpRecommendation,
  extractCodexPreflightRecommendation,
  extractCodexProfileRecommendation,
  extractCodexRecommendation,
  summarizeCodexOutput,
} from "./parsing.js";
import { executeCodexInteraction } from "./runtime.js";
import {
  buildCodexClarifyFollowUpJsonSchema,
  buildCodexPreflightJsonSchema,
  buildCodexProfileRecommendationJsonSchema,
  buildCodexWinnerRecommendationSchema,
} from "./schemas.js";

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
    const { execution, output } = await executeCodexInteraction({
      binaryPath: this.binaryPath,
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      filenames: {
        finalMessage: "codex.final-message.txt",
        prompt: "prompt.txt",
        stderr: "codex.stderr.txt",
        stdout: "codex.stdout.jsonl",
      },
      logDir: request.logDir,
      prompt,
      sandboxMode: "workspace-write",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeCodexOutput(output, "Codex candidate execution finished."),
    });
  }

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex winner selection finished.",
      filenames: {
        finalMessage: "winner-judge.final-message.txt",
        prompt: "winner-judge.prompt.txt",
        schema: "winner-judge.schema.json",
        stderr: "winner-judge.stderr.txt",
        stdout: "winner-judge.stdout.jsonl",
      },
      outputParser: extractCodexRecommendation,
      outputSchema: buildCodexWinnerRecommendationSchema(),
      prompt: buildWinnerSelectionPrompt(request),
      request,
      resultSchema: agentJudgeResultSchema,
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex preflight readiness finished.",
      filenames: {
        finalMessage: "preflight-judge.final-message.txt",
        prompt: "preflight-judge.prompt.txt",
        schema: "preflight-judge.schema.json",
        stderr: "preflight-judge.stderr.txt",
        stdout: "preflight-judge.stdout.jsonl",
      },
      outputParser: extractCodexPreflightRecommendation,
      outputSchema: buildCodexPreflightJsonSchema(),
      prompt: buildPreflightPrompt(request),
      request,
      resultSchema: agentPreflightResultSchema,
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex clarify follow-up finished.",
      filenames: {
        finalMessage: "clarify-follow-up.final-message.txt",
        prompt: "clarify-follow-up.prompt.txt",
        schema: "clarify-follow-up.schema.json",
        stderr: "clarify-follow-up.stderr.txt",
        stdout: "clarify-follow-up.stdout.jsonl",
      },
      outputParser: extractCodexClarifyFollowUpRecommendation,
      outputSchema: buildCodexClarifyFollowUpJsonSchema(),
      prompt: buildClarifyFollowUpPrompt(request),
      request,
      resultSchema: agentClarifyFollowUpResultSchema,
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex profile selection finished.",
      filenames: {
        finalMessage: "profile-judge.final-message.txt",
        prompt: "profile-judge.prompt.txt",
        schema: "profile-judge.schema.json",
        stderr: "profile-judge.stderr.txt",
        stdout: "profile-judge.stdout.jsonl",
      },
      outputParser: extractCodexProfileRecommendation,
      outputSchema: buildCodexProfileRecommendationJsonSchema(),
      prompt: buildProfileSelectionPrompt(request),
      request,
      resultSchema: agentProfileResultSchema,
    });
  }

  private async runRecommendation<
    Request extends { logDir: string; projectRoot: string; runId: string },
    Recommendation,
    Result,
  >(options: {
    fallbackSummary: string;
    filenames: {
      finalMessage: string;
      prompt: string;
      schema: string;
      stderr: string;
      stdout: string;
    };
    outputParser: (output: string) => Recommendation | undefined;
    outputSchema: Record<string, unknown>;
    prompt: string;
    request: Request;
    resultSchema: {
      parse(value: unknown): Result;
    };
  }): Promise<Result> {
    const { execution, output } = await executeCodexInteraction({
      binaryPath: this.binaryPath,
      cwd: options.request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      filenames: options.filenames,
      logDir: options.request.logDir,
      outputSchema: options.outputSchema,
      prompt: options.prompt,
      sandboxMode: "read-only",
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return options.resultSchema.parse({
      runId: options.request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeCodexOutput(output, options.fallbackSummary),
      recommendation: options.outputParser(output),
    });
  }
}
