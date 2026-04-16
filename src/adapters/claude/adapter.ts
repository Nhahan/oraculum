import { buildAgentProfileRecommendationJsonSchema } from "../../domain/profile.js";
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
  buildAgentClarifyFollowUpJsonSchema,
  buildAgentPreflightJsonSchema,
} from "../types.js";
import {
  extractClaudeClarifyFollowUpRecommendation,
  extractClaudePreflightRecommendation,
  extractClaudeProfileRecommendation,
  extractClaudeRecommendation,
  summarizeClaudeOutput,
} from "./parsing.js";
import { executeClaudeInteraction } from "./runtime.js";
import { buildClaudeWinnerRecommendationSchema } from "./schemas.js";

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
    const { execution, output } = await executeClaudeInteraction({
      binaryPath: this.binaryPath,
      cwd: request.workspaceDir,
      ...(this.env ? { env: this.env } : {}),
      filenames: {
        prompt: "prompt.txt",
        stderr: "claude.stderr.txt",
        stdout: "claude.stdout.txt",
      },
      logDir: request.logDir,
      permissionMode: "bypassPermissions",
      prompt,
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return agentRunResultSchema.parse({
      runId: request.runId,
      candidateId: request.candidateId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeClaudeOutput(output, "Claude candidate execution finished."),
    });
  }

  async recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude winner selection finished.",
      filenames: {
        prompt: "winner-judge.prompt.txt",
        stderr: "winner-judge.stderr.txt",
        stdout: "winner-judge.stdout.txt",
      },
      jsonSchema: buildClaudeWinnerRecommendationSchema(),
      outputParser: extractClaudeRecommendation,
      prompt: buildWinnerSelectionPrompt(request),
      request,
      resultSchema: agentJudgeResultSchema,
    });
  }

  async recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude preflight readiness finished.",
      filenames: {
        prompt: "preflight-judge.prompt.txt",
        stderr: "preflight-judge.stderr.txt",
        stdout: "preflight-judge.stdout.txt",
      },
      jsonSchema: buildAgentPreflightJsonSchema(),
      outputParser: extractClaudePreflightRecommendation,
      prompt: buildPreflightPrompt(request),
      request,
      resultSchema: agentPreflightResultSchema,
    });
  }

  async recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude clarify follow-up finished.",
      filenames: {
        prompt: "clarify-follow-up.prompt.txt",
        stderr: "clarify-follow-up.stderr.txt",
        stdout: "clarify-follow-up.stdout.txt",
      },
      jsonSchema: buildAgentClarifyFollowUpJsonSchema(),
      outputParser: extractClaudeClarifyFollowUpRecommendation,
      prompt: buildClarifyFollowUpPrompt(request),
      request,
      resultSchema: agentClarifyFollowUpResultSchema,
    });
  }

  async recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude profile selection finished.",
      filenames: {
        prompt: "profile-judge.prompt.txt",
        stderr: "profile-judge.stderr.txt",
        stdout: "profile-judge.stdout.txt",
      },
      jsonSchema: buildAgentProfileRecommendationJsonSchema(),
      outputParser: extractClaudeProfileRecommendation,
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
      prompt: string;
      stderr: string;
      stdout: string;
    };
    jsonSchema: Record<string, unknown>;
    outputParser: (output: string) => Recommendation | undefined;
    prompt: string;
    request: Request;
    resultSchema: {
      parse(value: unknown): Result;
    };
  }): Promise<Result> {
    const { execution, output } = await executeClaudeInteraction({
      binaryPath: this.binaryPath,
      cwd: options.request.projectRoot,
      ...(this.env ? { env: this.env } : {}),
      filenames: options.filenames,
      jsonSchema: options.jsonSchema,
      logDir: options.request.logDir,
      permissionMode: "plan",
      prompt: options.prompt,
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });

    return options.resultSchema.parse({
      runId: options.request.runId,
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeClaudeOutput(output, options.fallbackSummary),
      recommendation: options.outputParser(output),
    });
  }
}
