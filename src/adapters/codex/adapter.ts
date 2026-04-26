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
} from "../types.js";
import {
  extractCodexCandidateSpecRecommendation,
  extractCodexClarifyFollowUpRecommendation,
  extractCodexPlanConsensusDraftRecommendation,
  extractCodexPlanConsensusReviewRecommendation,
  extractCodexPlanningDepthRecommendation,
  extractCodexPlanningQuestionRecommendation,
  extractCodexPlanningScoreRecommendation,
  extractCodexPlanningSpecRecommendation,
  extractCodexPlanReviewRecommendation,
  extractCodexPreflightRecommendation,
  extractCodexProfileRecommendation,
  extractCodexRecommendation,
  extractCodexSpecSelectionRecommendation,
  summarizeCodexOutput,
} from "./parsing.js";
import { executeCodexInteraction } from "./runtime.js";
import {
  buildCodexCandidateSpecJsonSchema,
  buildCodexClarifyFollowUpJsonSchema,
  buildCodexPlanConsensusDraftJsonSchema,
  buildCodexPlanConsensusReviewJsonSchema,
  buildCodexPlanningDepthJsonSchema,
  buildCodexPlanningQuestionJsonSchema,
  buildCodexPlanningScoreJsonSchema,
  buildCodexPlanningSpecJsonSchema,
  buildCodexPlanReviewJsonSchema,
  buildCodexPreflightJsonSchema,
  buildCodexProfileRecommendationJsonSchema,
  buildCodexSpecSelectionJsonSchema,
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

  async recommendPlanReview(request: AgentPlanReviewRequest): Promise<AgentPlanReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex plan review finished.",
      filenames: {
        finalMessage: "plan-review.final-message.txt",
        prompt: "plan-review.prompt.txt",
        schema: "plan-review.schema.json",
        stderr: "plan-review.stderr.txt",
        stdout: "plan-review.stdout.jsonl",
      },
      outputParser: extractCodexPlanReviewRecommendation,
      outputSchema: buildCodexPlanReviewJsonSchema(),
      prompt: buildPlanReviewPrompt(request),
      request,
      resultSchema: agentPlanReviewResultSchema,
    });
  }

  async recommendPlanningDepth(
    request: AgentPlanningDepthRequest,
  ): Promise<AgentPlanningDepthResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex planning depth selection finished.",
      filenames: {
        finalMessage: "planning-depth.final-message.txt",
        prompt: "planning-depth.prompt.txt",
        schema: "planning-depth.schema.json",
        stderr: "planning-depth.stderr.txt",
        stdout: "planning-depth.stdout.jsonl",
      },
      outputParser: extractCodexPlanningDepthRecommendation,
      outputSchema: buildCodexPlanningDepthJsonSchema(),
      prompt: buildPlanningDepthPrompt(request),
      request,
      resultSchema: agentPlanningDepthResultSchema,
    });
  }

  async generatePlanningInterviewQuestion(
    request: AgentPlanningQuestionRequest,
  ): Promise<AgentPlanningQuestionResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Augury Interview question finished.",
      filenames: {
        finalMessage: "planning-question.final-message.txt",
        prompt: "planning-question.prompt.txt",
        schema: "planning-question.schema.json",
        stderr: "planning-question.stderr.txt",
        stdout: "planning-question.stdout.jsonl",
      },
      outputParser: extractCodexPlanningQuestionRecommendation,
      outputSchema: buildCodexPlanningQuestionJsonSchema(),
      prompt: buildPlanningInterviewQuestionPrompt(request),
      request,
      resultSchema: agentPlanningQuestionResultSchema,
    });
  }

  async scorePlanningInterviewRound(
    request: AgentPlanningScoreRequest,
  ): Promise<AgentPlanningScoreResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Augury Interview scoring finished.",
      filenames: {
        finalMessage: "planning-score.final-message.txt",
        prompt: "planning-score.prompt.txt",
        schema: "planning-score.schema.json",
        stderr: "planning-score.stderr.txt",
        stdout: "planning-score.stdout.jsonl",
      },
      outputParser: extractCodexPlanningScoreRecommendation,
      outputSchema: buildCodexPlanningScoreJsonSchema(),
      prompt: buildPlanningInterviewScorePrompt(request),
      request,
      resultSchema: agentPlanningScoreResultSchema,
    });
  }

  async crystallizePlanningSpec(
    request: AgentPlanningSpecRequest,
  ): Promise<AgentPlanningSpecResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex planning spec crystallization finished.",
      filenames: {
        finalMessage: "planning-spec.final-message.txt",
        prompt: "planning-spec.prompt.txt",
        schema: "planning-spec.schema.json",
        stderr: "planning-spec.stderr.txt",
        stdout: "planning-spec.stdout.jsonl",
      },
      outputParser: extractCodexPlanningSpecRecommendation,
      outputSchema: buildCodexPlanningSpecJsonSchema(),
      prompt: buildPlanningSpecPrompt(request),
      request,
      resultSchema: agentPlanningSpecResultSchema,
    });
  }

  async draftConsensusConsultationPlan(
    request: AgentPlanConsensusDraftRequest,
  ): Promise<AgentPlanConsensusDraftResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Plan Conclave draft finished.",
      filenames: {
        finalMessage: "plan-consensus-draft.final-message.txt",
        prompt: "plan-consensus-draft.prompt.txt",
        schema: "plan-consensus-draft.schema.json",
        stderr: "plan-consensus-draft.stderr.txt",
        stdout: "plan-consensus-draft.stdout.jsonl",
      },
      outputParser: extractCodexPlanConsensusDraftRecommendation,
      outputSchema: buildCodexPlanConsensusDraftJsonSchema(),
      prompt: buildPlanConsensusDraftPrompt(request),
      request,
      resultSchema: agentPlanConsensusDraftResultSchema,
    });
  }

  async reviewPlanArchitecture(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Plan Conclave architect review finished.",
      filenames: {
        finalMessage: "plan-architect-review.final-message.txt",
        prompt: "plan-architect-review.prompt.txt",
        schema: "plan-architect-review.schema.json",
        stderr: "plan-architect-review.stderr.txt",
        stdout: "plan-architect-review.stdout.jsonl",
      },
      outputParser: extractCodexPlanConsensusReviewRecommendation,
      outputSchema: buildCodexPlanConsensusReviewJsonSchema(),
      prompt: buildPlanArchitectureReviewPrompt(request),
      request,
      resultSchema: agentPlanConsensusReviewResultSchema,
    });
  }

  async reviewPlanCritic(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Plan Conclave critic review finished.",
      filenames: {
        finalMessage: "plan-critic-review.final-message.txt",
        prompt: "plan-critic-review.prompt.txt",
        schema: "plan-critic-review.schema.json",
        stderr: "plan-critic-review.stderr.txt",
        stdout: "plan-critic-review.stdout.jsonl",
      },
      outputParser: extractCodexPlanConsensusReviewRecommendation,
      outputSchema: buildCodexPlanConsensusReviewJsonSchema(),
      prompt: buildPlanCriticReviewPrompt(request),
      request,
      resultSchema: agentPlanConsensusReviewResultSchema,
    });
  }

  async reviseConsensusConsultationPlan(
    request: AgentPlanConsensusRevisionRequest,
  ): Promise<AgentPlanConsensusDraftResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex Plan Conclave revision finished.",
      filenames: {
        finalMessage: "plan-consensus-revision.final-message.txt",
        prompt: "plan-consensus-revision.prompt.txt",
        schema: "plan-consensus-revision.schema.json",
        stderr: "plan-consensus-revision.stderr.txt",
        stdout: "plan-consensus-revision.stdout.jsonl",
      },
      outputParser: extractCodexPlanConsensusDraftRecommendation,
      outputSchema: buildCodexPlanConsensusDraftJsonSchema(),
      prompt: buildPlanConsensusRevisionPrompt(request),
      request,
      resultSchema: agentPlanConsensusDraftResultSchema,
    });
  }

  async proposeCandidateSpec(
    request: AgentCandidateSpecRequest,
  ): Promise<AgentCandidateSpecResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex candidate spec proposal finished.",
      filenames: {
        finalMessage: "candidate-spec.final-message.txt",
        prompt: "candidate-spec.prompt.txt",
        schema: "candidate-spec.schema.json",
        stderr: "candidate-spec.stderr.txt",
        stdout: "candidate-spec.stdout.jsonl",
      },
      outputParser: extractCodexCandidateSpecRecommendation,
      outputSchema: buildCodexCandidateSpecJsonSchema(),
      prompt: buildCandidateSpecPrompt(request),
      request,
      resultSchema: agentCandidateSpecResultSchema,
    });
  }

  async selectCandidateSpec(
    request: AgentCandidateSpecSelectionRequest,
  ): Promise<AgentCandidateSpecSelectionResult> {
    return this.runRecommendation({
      fallbackSummary: "Codex candidate spec selection finished.",
      filenames: {
        finalMessage: "spec-selection.final-message.txt",
        prompt: "spec-selection.prompt.txt",
        schema: "spec-selection.schema.json",
        stderr: "spec-selection.stderr.txt",
        stdout: "spec-selection.stdout.jsonl",
      },
      outputParser: extractCodexSpecSelectionRecommendation,
      outputSchema: buildCodexSpecSelectionJsonSchema(),
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
      ...("candidateId" in options.request && typeof options.request.candidateId === "string"
        ? { candidateId: options.request.candidateId }
        : {}),
      adapter: this.name,
      ...buildAdapterResultBase(execution),
      summary: summarizeCodexOutput(output, options.fallbackSummary),
      recommendation: options.outputParser(output),
    });
  }
}
