import { buildAgentProfileRecommendationJsonSchema } from "../../domain/profile.js";
import { buildAdapterResultBase } from "../execution.js";
import {
  buildCandidatePrompt,
  buildCandidateSpecPrompt,
  buildClarifyFollowUpPrompt,
  buildPlanArchitectureReviewPrompt,
  buildPlanConsensusDraftPrompt,
  buildPlanConsensusRevisionPrompt,
  buildPlanCriticReviewPrompt,
  buildPlanningDepthPrompt,
  buildPlanningInterviewQuestionPrompt,
  buildPlanningInterviewScorePrompt,
  buildPlanningSpecPrompt,
  buildPlanReviewPrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildSpecSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "../prompt.js";
import {
  type AgentAdapter,
  type AgentCandidateSpecRequest,
  type AgentCandidateSpecResult,
  type AgentCandidateSpecSelectionRequest,
  type AgentCandidateSpecSelectionResult,
  type AgentClarifyFollowUpRequest,
  type AgentClarifyFollowUpResult,
  type AgentJudgeRequest,
  type AgentJudgeResult,
  type AgentPlanConsensusDraftRequest,
  type AgentPlanConsensusDraftResult,
  type AgentPlanConsensusReviewRequest,
  type AgentPlanConsensusReviewResult,
  type AgentPlanConsensusRevisionRequest,
  type AgentPlanningDepthRequest,
  type AgentPlanningDepthResult,
  type AgentPlanningQuestionRequest,
  type AgentPlanningQuestionResult,
  type AgentPlanningScoreRequest,
  type AgentPlanningScoreResult,
  type AgentPlanningSpecRequest,
  type AgentPlanningSpecResult,
  type AgentPlanReviewRequest,
  type AgentPlanReviewResult,
  type AgentPreflightRequest,
  type AgentPreflightResult,
  type AgentProfileRequest,
  type AgentProfileResult,
  type AgentRunRequest,
  type AgentRunResult,
  agentCandidateSpecResultSchema,
  agentCandidateSpecSelectionResultSchema,
  agentClarifyFollowUpResultSchema,
  agentJudgeResultSchema,
  agentPlanConsensusDraftResultSchema,
  agentPlanConsensusReviewResultSchema,
  agentPlanningDepthResultSchema,
  agentPlanningQuestionResultSchema,
  agentPlanningScoreResultSchema,
  agentPlanningSpecResultSchema,
  agentPlanReviewResultSchema,
  agentPreflightResultSchema,
  agentProfileResultSchema,
  agentRunResultSchema,
  buildAgentCandidateSpecJsonSchema,
  buildAgentCandidateSpecSelectionJsonSchema,
  buildAgentClarifyFollowUpJsonSchema,
  buildAgentPlanConsensusDraftJsonSchema,
  buildAgentPlanConsensusReviewJsonSchema,
  buildAgentPlanningDepthJsonSchema,
  buildAgentPlanningQuestionJsonSchema,
  buildAgentPlanningScoreJsonSchema,
  buildAgentPlanningSpecJsonSchema,
  buildAgentPlanReviewJsonSchema,
  buildAgentPreflightJsonSchema,
} from "../types.js";
import {
  extractClaudeCandidateSpecRecommendation,
  extractClaudeClarifyFollowUpRecommendation,
  extractClaudePlanConsensusDraftRecommendation,
  extractClaudePlanConsensusReviewRecommendation,
  extractClaudePlanningDepthRecommendation,
  extractClaudePlanningQuestionRecommendation,
  extractClaudePlanningScoreRecommendation,
  extractClaudePlanningSpecRecommendation,
  extractClaudePlanReviewRecommendation,
  extractClaudePreflightRecommendation,
  extractClaudeProfileRecommendation,
  extractClaudeRecommendation,
  extractClaudeSpecSelectionRecommendation,
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

  async recommendPlanReview(request: AgentPlanReviewRequest): Promise<AgentPlanReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude plan review finished.",
      filenames: {
        prompt: "plan-review.prompt.txt",
        stderr: "plan-review.stderr.txt",
        stdout: "plan-review.stdout.txt",
      },
      jsonSchema: buildAgentPlanReviewJsonSchema(),
      outputParser: extractClaudePlanReviewRecommendation,
      prompt: buildPlanReviewPrompt(request),
      request,
      resultSchema: agentPlanReviewResultSchema,
    });
  }

  async recommendPlanningDepth(
    request: AgentPlanningDepthRequest,
  ): Promise<AgentPlanningDepthResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude planning depth selection finished.",
      filenames: {
        prompt: "planning-depth.prompt.txt",
        stderr: "planning-depth.stderr.txt",
        stdout: "planning-depth.stdout.txt",
      },
      jsonSchema: buildAgentPlanningDepthJsonSchema(),
      outputParser: extractClaudePlanningDepthRecommendation,
      prompt: buildPlanningDepthPrompt(request),
      request,
      resultSchema: agentPlanningDepthResultSchema,
    });
  }

  async generatePlanningInterviewQuestion(
    request: AgentPlanningQuestionRequest,
  ): Promise<AgentPlanningQuestionResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Augury Interview question finished.",
      filenames: {
        prompt: "planning-question.prompt.txt",
        stderr: "planning-question.stderr.txt",
        stdout: "planning-question.stdout.txt",
      },
      jsonSchema: buildAgentPlanningQuestionJsonSchema(),
      outputParser: extractClaudePlanningQuestionRecommendation,
      prompt: buildPlanningInterviewQuestionPrompt(request),
      request,
      resultSchema: agentPlanningQuestionResultSchema,
    });
  }

  async scorePlanningInterviewRound(
    request: AgentPlanningScoreRequest,
  ): Promise<AgentPlanningScoreResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Augury Interview scoring finished.",
      filenames: {
        prompt: "planning-score.prompt.txt",
        stderr: "planning-score.stderr.txt",
        stdout: "planning-score.stdout.txt",
      },
      jsonSchema: buildAgentPlanningScoreJsonSchema(),
      outputParser: extractClaudePlanningScoreRecommendation,
      prompt: buildPlanningInterviewScorePrompt(request),
      request,
      resultSchema: agentPlanningScoreResultSchema,
    });
  }

  async crystallizePlanningSpec(
    request: AgentPlanningSpecRequest,
  ): Promise<AgentPlanningSpecResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude planning spec crystallization finished.",
      filenames: {
        prompt: "planning-spec.prompt.txt",
        stderr: "planning-spec.stderr.txt",
        stdout: "planning-spec.stdout.txt",
      },
      jsonSchema: buildAgentPlanningSpecJsonSchema(),
      outputParser: extractClaudePlanningSpecRecommendation,
      prompt: buildPlanningSpecPrompt(request),
      request,
      resultSchema: agentPlanningSpecResultSchema,
    });
  }

  async draftConsensusConsultationPlan(
    request: AgentPlanConsensusDraftRequest,
  ): Promise<AgentPlanConsensusDraftResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Plan Conclave draft finished.",
      filenames: {
        prompt: "plan-consensus-draft.prompt.txt",
        stderr: "plan-consensus-draft.stderr.txt",
        stdout: "plan-consensus-draft.stdout.txt",
      },
      jsonSchema: buildAgentPlanConsensusDraftJsonSchema(),
      outputParser: extractClaudePlanConsensusDraftRecommendation,
      prompt: buildPlanConsensusDraftPrompt(request),
      request,
      resultSchema: agentPlanConsensusDraftResultSchema,
    });
  }

  async reviewPlanArchitecture(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Plan Conclave architect review finished.",
      filenames: {
        prompt: "plan-architect-review.prompt.txt",
        stderr: "plan-architect-review.stderr.txt",
        stdout: "plan-architect-review.stdout.txt",
      },
      jsonSchema: buildAgentPlanConsensusReviewJsonSchema(),
      outputParser: extractClaudePlanConsensusReviewRecommendation,
      prompt: buildPlanArchitectureReviewPrompt(request),
      request,
      resultSchema: agentPlanConsensusReviewResultSchema,
    });
  }

  async reviewPlanCritic(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Plan Conclave critic review finished.",
      filenames: {
        prompt: "plan-critic-review.prompt.txt",
        stderr: "plan-critic-review.stderr.txt",
        stdout: "plan-critic-review.stdout.txt",
      },
      jsonSchema: buildAgentPlanConsensusReviewJsonSchema(),
      outputParser: extractClaudePlanConsensusReviewRecommendation,
      prompt: buildPlanCriticReviewPrompt(request),
      request,
      resultSchema: agentPlanConsensusReviewResultSchema,
    });
  }

  async reviseConsensusConsultationPlan(
    request: AgentPlanConsensusRevisionRequest,
  ): Promise<AgentPlanConsensusDraftResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude Plan Conclave revision finished.",
      filenames: {
        prompt: "plan-consensus-revision.prompt.txt",
        stderr: "plan-consensus-revision.stderr.txt",
        stdout: "plan-consensus-revision.stdout.txt",
      },
      jsonSchema: buildAgentPlanConsensusDraftJsonSchema(),
      outputParser: extractClaudePlanConsensusDraftRecommendation,
      prompt: buildPlanConsensusRevisionPrompt(request),
      request,
      resultSchema: agentPlanConsensusDraftResultSchema,
    });
  }

  async proposeCandidateSpec(
    request: AgentCandidateSpecRequest,
  ): Promise<AgentCandidateSpecResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude candidate spec proposal finished.",
      filenames: {
        prompt: "candidate-spec.prompt.txt",
        stderr: "candidate-spec.stderr.txt",
        stdout: "candidate-spec.stdout.txt",
      },
      jsonSchema: buildAgentCandidateSpecJsonSchema(),
      outputParser: extractClaudeCandidateSpecRecommendation,
      prompt: buildCandidateSpecPrompt(request),
      request,
      resultSchema: agentCandidateSpecResultSchema,
    });
  }

  async selectCandidateSpec(
    request: AgentCandidateSpecSelectionRequest,
  ): Promise<AgentCandidateSpecSelectionResult> {
    return this.runRecommendation({
      fallbackSummary: "Claude candidate spec selection finished.",
      filenames: {
        prompt: "spec-selection.prompt.txt",
        stderr: "spec-selection.stderr.txt",
        stdout: "spec-selection.stdout.txt",
      },
      jsonSchema: buildAgentCandidateSpecSelectionJsonSchema(),
      outputParser: extractClaudeSpecSelectionRecommendation,
      prompt: buildSpecSelectionPrompt(request),
      request,
      resultSchema: agentCandidateSpecSelectionResultSchema,
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
      ...("candidateId" in options.request && typeof options.request.candidateId === "string"
        ? { candidateId: options.request.candidateId }
        : {}),
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeClaudeOutput(output, options.fallbackSummary),
      recommendation: options.outputParser(output),
    });
  }
}
