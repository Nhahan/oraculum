import { z } from "zod";

import { type Adapter, adapterSchema } from "../domain/config.js";
import {
  type AgentProfileRecommendation,
  agentProfileRecommendationSchema,
  type DecisionConfidence,
  decisionConfidenceSchema,
  type ProfileRepoSignals,
} from "../domain/profile.js";
import {
  type CandidateSpecArtifact,
  type CandidateSpecContent,
  type CandidateSpecSelectionRecommendation,
  type ConsultationClarifyFollowUp,
  type ConsultationPlanArtifact,
  type ConsultationPlanReview,
  type ConsultationPreflight,
  candidateScorecardSchema,
  candidateSpecContentSchema,
  candidateSpecSelectionRecommendationSchema,
  type clarifyPressureKindSchema,
  type clarifyScopeKeyTypeSchema,
  consultationClarifyFollowUpSchema,
  consultationPlanReviewSchema,
  consultationPreflightSchema,
  type PlanConsensusArtifact,
  type PlanConsensusContinuation,
  type PlanConsensusDraft,
  type PlanConsensusReview,
  type PlanningDepthArtifact,
  type PlanningInterviewArtifact,
  type PlanningSpecArtifact,
  planConsensusContinuationClassificationSchema,
  planConsensusDraftSchema,
  planConsensusReviewSchema,
  planningConsensusReviewIntensitySchema,
  planningContinuationClassificationSchema,
  planningInterviewDepthSchema,
  planningInterviewRoundSchema,
  planningSpecArtifactSchema,
} from "../domain/run.js";
import type { MaterializedTaskPacket } from "../domain/task.js";

export const agentArtifactKindSchema = z.enum([
  "log",
  "patch",
  "prompt",
  "report",
  "stderr",
  "stdout",
  "transcript",
]);
export const agentRunStatusSchema = z.enum(["completed", "failed", "timed-out", "cancelled"]);

export const agentArtifactSchema = z.object({
  kind: agentArtifactKindSchema,
  path: z.string().min(1),
});

export const agentRunResultSchema = z.object({
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const finalistVerdictSchema = z.object({
  roundId: z.string().min(1),
  oracleId: z.string().min(1),
  status: z.string().min(1),
  severity: z.string().min(1),
  summary: z.string().min(1),
});
export const finalistChangeSummarySchema = z.object({
  mode: z.enum(["git-diff", "snapshot-diff", "none"]),
  changedPathCount: z.number().int().min(0),
  createdPathCount: z.number().int().min(0),
  removedPathCount: z.number().int().min(0),
  modifiedPathCount: z.number().int().min(0),
  addedLineCount: z.number().int().min(0).optional(),
  deletedLineCount: z.number().int().min(0).optional(),
});
export const finalistWitnessHighlightSchema = z.object({
  roundId: z.string().min(1),
  oracleId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
});
export const finalistWitnessRollupSchema = z.object({
  witnessCount: z.number().int().min(0),
  warningOrHigherCount: z.number().int().min(0),
  repairableCount: z.number().int().min(0),
  repairHints: z.array(z.string().min(1)).default([]),
  riskSummaries: z.array(z.string().min(1)).default([]),
  keyWitnesses: z.array(finalistWitnessHighlightSchema).default([]),
});
export const finalistRepairSummarySchema = z.object({
  attemptCount: z.number().int().min(0),
  repairedRounds: z.array(z.string().min(1)).default([]),
});

export const finalistSummarySchema = z.object({
  candidateId: z.string().min(1),
  strategyLabel: z.string().min(1),
  summary: z.string().min(1),
  artifactKinds: z.array(agentArtifactKindSchema).default([]),
  verdicts: z.array(finalistVerdictSchema),
  changedPaths: z.array(z.string().min(1)).default([]),
  changeSummary: finalistChangeSummarySchema,
  witnessRollup: finalistWitnessRollupSchema,
  repairSummary: finalistRepairSummarySchema,
  plannedScorecard: candidateScorecardSchema.omit({ candidateId: true }).optional(),
});

export const agentJudgeRecommendationSchema = z
  .object({
    decision: z.enum(["select", "abstain"]),
    candidateId: z.string().min(1).nullable().optional(),
    confidence: decisionConfidenceSchema,
    summary: z.string().min(1),
    judgingCriteria: z.array(z.string().min(1)).min(1).max(5).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "select" && !value.candidateId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateId"],
        message: "candidateId is required when decision is select.",
      });
    }
  });

export const agentJudgeResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: agentJudgeRecommendationSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const agentProfileResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: agentProfileRecommendationSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const agentPreflightResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: consultationPreflightSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const agentClarifyFollowUpResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: consultationClarifyFollowUpSchema
    .omit({
      runId: true,
      adapter: true,
      decision: true,
      scopeKeyType: true,
      scopeKey: true,
      repeatedCaseCount: true,
      repeatedKinds: true,
      recurringReasons: true,
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanReviewResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: consultationPlanReviewSchema
    .omit({
      runId: true,
      createdAt: true,
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

const agentPlanningDepthRecommendationSchema = z.object({
  interviewDepth: planningInterviewDepthSchema,
  readiness: z.enum(["ready", "needs-interview", "blocked"]),
  confidence: decisionConfidenceSchema,
  summary: z.string().min(1),
  reasons: z.array(z.string().min(1)).default([]),
  estimatedInterviewRounds: z.number().int().min(0).max(8),
  consensusReviewIntensity: planningConsensusReviewIntensitySchema,
});

export const agentCandidateSpecResultSchema = z.object({
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: candidateSpecContentSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const agentCandidateSpecSelectionResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: candidateSpecSelectionRecommendationSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export const agentPlanningDepthResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: agentPlanningDepthRecommendationSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanningContinuationResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: z
    .object({
      classification: planningContinuationClassificationSchema,
      confidence: decisionConfidenceSchema,
      summary: z.string().min(1),
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanConsensusContinuationResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: z
    .object({
      classification: planConsensusContinuationClassificationSchema,
      confidence: decisionConfidenceSchema,
      summary: z.string().min(1),
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanningQuestionResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: planningInterviewRoundSchema
    .pick({
      question: true,
      perspective: true,
      expectedAnswerShape: true,
    })
    .required({
      expectedAnswerShape: true,
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanningScoreResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: planningInterviewRoundSchema
    .pick({
      clarityScore: true,
      weakestDimension: true,
      readyForSpec: true,
      assumptions: true,
      ontologySnapshot: true,
    })
    .required({
      clarityScore: true,
      weakestDimension: true,
      readyForSpec: true,
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanningSpecResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: planningSpecArtifactSchema
    .omit({
      runId: true,
      createdAt: true,
      taskId: true,
    })
    .optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanConsensusDraftResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: planConsensusDraftSchema.optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});
export const agentPlanConsensusReviewResultSchema = z.object({
  runId: z.string().min(1),
  adapter: adapterSchema,
  status: agentRunStatusSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  exitCode: z.number().int(),
  summary: z.string().min(1),
  recommendation: planConsensusReviewSchema.omit({ reviewer: true }).optional(),
  artifacts: z.array(agentArtifactSchema).default([]),
});

export interface AgentRunRequest {
  runId: string;
  candidateId: string;
  strategyId: string;
  strategyLabel: string;
  workspaceDir: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  selectedSpec?: CandidateSpecArtifact;
  repairContext?: AgentRepairContext;
}

export interface AgentAdapter {
  readonly name: Adapter;

  runCandidate(request: AgentRunRequest): Promise<AgentRunResult>;
  recommendWinner(request: AgentJudgeRequest): Promise<AgentJudgeResult>;
  recommendPreflight(request: AgentPreflightRequest): Promise<AgentPreflightResult>;
  recommendClarifyFollowUp(
    request: AgentClarifyFollowUpRequest,
  ): Promise<AgentClarifyFollowUpResult>;
  recommendProfile(request: AgentProfileRequest): Promise<AgentProfileResult>;
  recommendPlanReview?(request: AgentPlanReviewRequest): Promise<AgentPlanReviewResult>;
  recommendPlanningDepth?(request: AgentPlanningDepthRequest): Promise<AgentPlanningDepthResult>;
  classifyPlanningContinuation?(
    request: AgentPlanningContinuationRequest,
  ): Promise<AgentPlanningContinuationResult>;
  classifyPlanConsensusContinuation?(
    request: AgentPlanConsensusContinuationRequest,
  ): Promise<AgentPlanConsensusContinuationResult>;
  generatePlanningInterviewQuestion?(
    request: AgentPlanningQuestionRequest,
  ): Promise<AgentPlanningQuestionResult>;
  scorePlanningInterviewRound?(
    request: AgentPlanningScoreRequest,
  ): Promise<AgentPlanningScoreResult>;
  crystallizePlanningSpec?(request: AgentPlanningSpecRequest): Promise<AgentPlanningSpecResult>;
  draftConsensusConsultationPlan?(
    request: AgentPlanConsensusDraftRequest,
  ): Promise<AgentPlanConsensusDraftResult>;
  reviewPlanArchitecture?(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult>;
  reviewPlanCritic?(
    request: AgentPlanConsensusReviewRequest,
  ): Promise<AgentPlanConsensusReviewResult>;
  reviseConsensusConsultationPlan?(
    request: AgentPlanConsensusRevisionRequest,
  ): Promise<AgentPlanConsensusDraftResult>;
  proposeCandidateSpec(request: AgentCandidateSpecRequest): Promise<AgentCandidateSpecResult>;
  selectCandidateSpec(
    request: AgentCandidateSpecSelectionRequest,
  ): Promise<AgentCandidateSpecSelectionResult>;
}

export interface AgentJudgeRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  finalists: FinalistSummary[];
  plannedJudgingPreset?: {
    decisionDrivers: string[];
    plannedJudgingCriteria: string[];
    crownGates: string[];
  };
  consultationProfile?: {
    confidence: DecisionConfidence;
    validationProfileId: string;
    validationSummary: string;
    validationSignals: string[];
    validationGaps: string[];
  };
}

export interface AgentProfileRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  signals: ProfileRepoSignals;
  validationPostureOptions: Array<{
    id: string;
    description: string;
  }>;
}

export interface AgentPreflightRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  signals: ProfileRepoSignals;
  requirePlanningClarification?: boolean;
}

export interface AgentClarifyFollowUpRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  signals: ProfileRepoSignals;
  preflight: ConsultationPreflight & {
    decision: "needs-clarification" | "external-research-required";
  };
  pressureContext: {
    scopeKeyType: z.infer<typeof clarifyScopeKeyTypeSchema>;
    scopeKey: string;
    repeatedCaseCount: number;
    repeatedKinds: Array<z.infer<typeof clarifyPressureKindSchema>>;
    recurringReasons: string[];
    priorQuestions: string[];
  };
}

export interface AgentPlanReviewRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  consultationPlan: ConsultationPlanArtifact;
}

export interface AgentPlanningDepthRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  maxInterviewRounds: number;
  operatorMaxConsensusLoopRevisions: number;
}

export interface AgentPlanningContinuationRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  activeInterview: PlanningInterviewArtifact;
}

export interface AgentPlanConsensusContinuationRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  activeConsensus: PlanConsensusArtifact;
  planningSpec: PlanningSpecArtifact;
  blocker: {
    blockerKind: PlanConsensusContinuation["blockerKind"];
    summary: string;
    requiredChanges: string[];
  };
}

export interface AgentPlanningQuestionRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  depth: Omit<PlanningDepthArtifact, "runId" | "createdAt">;
  interview?: PlanningInterviewArtifact;
}

export interface AgentPlanningScoreRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  interview: PlanningInterviewArtifact;
  answer: string;
}

export interface AgentPlanningSpecRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  depth: PlanningDepthArtifact;
  interview?: PlanningInterviewArtifact;
}

export interface AgentPlanConsensusDraftRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  planningSpec: PlanningSpecArtifact;
  consultationPlan: ConsultationPlanArtifact;
  planConsensusRemediation?: AgentPlanConsensusRemediationContext;
}

export interface AgentPlanConsensusReviewRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  planningSpec: PlanningSpecArtifact;
  draft: PlanConsensusDraft;
  planConsensusRemediation?: AgentPlanConsensusRemediationContext;
}

export interface AgentPlanConsensusRevisionRequest extends AgentPlanConsensusReviewRequest {
  revision: number;
  architectReview?: PlanConsensusReview;
  criticReview?: PlanConsensusReview;
}

export interface AgentCandidateSpecRequest {
  runId: string;
  candidateId: string;
  strategyId: string;
  strategyLabel: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  consultationPlan?: ConsultationPlanArtifact;
}

export interface AgentCandidateSpecSelectionRequest {
  runId: string;
  projectRoot: string;
  logDir: string;
  taskPacket: MaterializedTaskPacket;
  specs: CandidateSpecArtifact[];
  consultationPlan?: ConsultationPlanArtifact;
  consultationProfile?: {
    confidence: DecisionConfidence;
    validationProfileId: string;
    validationSummary: string;
    validationSignals: string[];
    validationGaps: string[];
  };
}

export interface AgentRepairContext {
  roundId: string;
  attempt: number;
  verdicts: Array<{
    oracleId: string;
    status: string;
    severity: string;
    summary: string;
    repairHint?: string;
  }>;
  keyWitnesses: Array<{
    title: string;
    detail: string;
    kind: string;
  }>;
}

export interface AgentPlanConsensusRemediationContext {
  continuation: PlanConsensusContinuation;
  sourceFinalDraft: PlanConsensusDraft;
  sourceRevisionHistory: PlanConsensusArtifact["revisionHistory"];
}

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
export type FinalistSummary = z.infer<typeof finalistSummarySchema>;
export type AgentJudgeRecommendation = z.infer<typeof agentJudgeRecommendationSchema>;
export type AgentJudgeResult = z.infer<typeof agentJudgeResultSchema>;
export type AgentProfileResult = z.infer<typeof agentProfileResultSchema>;
export type AgentPreflightResult = z.infer<typeof agentPreflightResultSchema>;
export type AgentClarifyFollowUpResult = z.infer<typeof agentClarifyFollowUpResultSchema>;
export type AgentPlanReviewResult = z.infer<typeof agentPlanReviewResultSchema>;
export type AgentCandidateSpecResult = z.infer<typeof agentCandidateSpecResultSchema>;
export type AgentCandidateSpecSelectionResult = z.infer<
  typeof agentCandidateSpecSelectionResultSchema
>;
export type AgentPlanningDepthResult = z.infer<typeof agentPlanningDepthResultSchema>;
export type AgentPlanningContinuationResult = z.infer<typeof agentPlanningContinuationResultSchema>;
export type AgentPlanConsensusContinuationResult = z.infer<
  typeof agentPlanConsensusContinuationResultSchema
>;
export type AgentPlanningQuestionResult = z.infer<typeof agentPlanningQuestionResultSchema>;
export type AgentPlanningScoreResult = z.infer<typeof agentPlanningScoreResultSchema>;
export type AgentPlanningSpecResult = z.infer<typeof agentPlanningSpecResultSchema>;
export type AgentPlanConsensusDraftResult = z.infer<typeof agentPlanConsensusDraftResultSchema>;
export type AgentPlanConsensusReviewResult = z.infer<typeof agentPlanConsensusReviewResultSchema>;
export type AgentPreflightRecommendation = ConsultationPreflight;
export type AgentClarifyFollowUpRecommendation = ConsultationClarifyFollowUp;
export type AgentPlanReviewRecommendation = Omit<ConsultationPlanReview, "runId" | "createdAt">;
export type AgentCandidateSpecRecommendation = CandidateSpecContent;
export type AgentCandidateSpecSelectionRecommendation = CandidateSpecSelectionRecommendation;
export type { AgentProfileRecommendation };

export function buildAgentPreflightJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: {
        type: "string",
        enum: ["proceed", "needs-clarification", "external-research-required", "abstain"],
      },
      confidence: {
        type: "string",
        enum: [...decisionConfidenceSchema.options],
      },
      summary: { type: "string", minLength: 1 },
      researchPosture: {
        type: "string",
        enum: ["repo-only", "repo-plus-external-docs", "external-research-required"],
      },
      clarificationQuestion: {
        anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
      },
      researchQuestion: {
        anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
      },
    },
    required: ["decision", "confidence", "summary", "researchPosture"],
  };
}

export function buildAgentClarifyFollowUpJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1 },
      keyQuestion: { type: "string", minLength: 1 },
      missingResultContract: { type: "string", minLength: 1 },
      missingJudgingBasis: { type: "string", minLength: 1 },
    },
    required: ["summary", "keyQuestion", "missingResultContract", "missingJudgingBasis"],
  };
}

export function buildAgentPlanReviewJsonSchema(): Record<string, unknown> {
  const stringArraySchema = {
    type: "array",
    items: { type: "string", minLength: 1 },
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["clear", "issues", "blocked"],
      },
      summary: { type: "string", minLength: 1 },
      blockers: stringArraySchema,
      warnings: stringArraySchema,
      riskFindings: stringArraySchema,
      invariantFindings: stringArraySchema,
      crownGateFindings: stringArraySchema,
      repairPolicyFindings: stringArraySchema,
      scorecardFindings: stringArraySchema,
      nextAction: { type: "string", minLength: 1 },
    },
    required: [
      "status",
      "summary",
      "blockers",
      "warnings",
      "riskFindings",
      "invariantFindings",
      "crownGateFindings",
      "repairPolicyFindings",
      "scorecardFindings",
      "nextAction",
    ],
  };
}

export function buildAgentCandidateSpecJsonSchema(): Record<string, unknown> {
  const stringArraySchema = {
    type: "array",
    items: { type: "string", minLength: 1 },
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1 },
      approach: { type: "string", minLength: 1 },
      keyChanges: {
        ...stringArraySchema,
        minItems: 1,
        maxItems: 8,
      },
      expectedChangedPaths: stringArraySchema,
      acceptanceCriteria: stringArraySchema,
      validationPlan: stringArraySchema,
      riskNotes: stringArraySchema,
    },
    required: [
      "summary",
      "approach",
      "keyChanges",
      "expectedChangedPaths",
      "acceptanceCriteria",
      "validationPlan",
      "riskNotes",
    ],
  };
}

export function buildAgentCandidateSpecSelectionJsonSchema(): Record<string, unknown> {
  const stringArraySchema = {
    type: "array",
    items: { type: "string", minLength: 1 },
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rankedCandidateIds: stringArraySchema,
      selectedCandidateIds: stringArraySchema,
      implementationVarianceRisk: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      validationGaps: stringArraySchema,
      summary: { type: "string", minLength: 1 },
      reasons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidateId: { type: "string", minLength: 1 },
            rank: { type: "integer", minimum: 1 },
            selected: { type: "boolean" },
            reason: { type: "string", minLength: 1 },
          },
          required: ["candidateId", "rank", "selected", "reason"],
        },
      },
    },
    required: [
      "rankedCandidateIds",
      "selectedCandidateIds",
      "implementationVarianceRisk",
      "validationGaps",
      "summary",
      "reasons",
    ],
  };
}

export function buildAgentPlanningDepthJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      interviewDepth: { type: "string", enum: ["skip-interview", "interview", "deep-interview"] },
      readiness: { type: "string", enum: ["ready", "needs-interview", "blocked"] },
      confidence: { type: "string", enum: [...decisionConfidenceSchema.options] },
      summary: { type: "string", minLength: 1 },
      reasons: { type: "array", items: { type: "string", minLength: 1 } },
      estimatedInterviewRounds: { type: "integer", minimum: 0, maximum: 8 },
      consensusReviewIntensity: { type: "string", enum: ["standard", "elevated", "high"] },
    },
    required: [
      "interviewDepth",
      "readiness",
      "confidence",
      "summary",
      "reasons",
      "estimatedInterviewRounds",
      "consensusReviewIntensity",
    ],
  };
}

export function buildAgentPlanningContinuationJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: { type: "string", enum: ["new-task", "continuation"] },
      confidence: { type: "string", enum: [...decisionConfidenceSchema.options] },
      summary: { type: "string", minLength: 1 },
    },
    required: ["classification", "confidence", "summary"],
  };
}

export function buildAgentPlanConsensusContinuationJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: { type: "string", enum: ["consensus-remediation", "new-task"] },
      confidence: { type: "string", enum: [...decisionConfidenceSchema.options] },
      summary: { type: "string", minLength: 1 },
    },
    required: ["classification", "confidence", "summary"],
  };
}

export function buildAgentPlanningQuestionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      question: { type: "string", minLength: 1 },
      perspective: { type: "string", minLength: 1 },
      expectedAnswerShape: { type: "string", minLength: 1 },
    },
    required: ["question", "perspective", "expectedAnswerShape"],
  };
}

export function buildAgentPlanningScoreJsonSchema(): Record<string, unknown> {
  const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };
  const ontologySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      goals: stringArraySchema,
      constraints: stringArraySchema,
      nonGoals: stringArraySchema,
      acceptanceCriteria: stringArraySchema,
      risks: stringArraySchema,
    },
    required: ["goals", "constraints", "nonGoals", "acceptanceCriteria", "risks"],
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      clarityScore: { type: "number", minimum: 0, maximum: 1 },
      weakestDimension: { type: "string", minLength: 1 },
      readyForSpec: { type: "boolean" },
      assumptions: stringArraySchema,
      ontologySnapshot: ontologySchema,
    },
    required: [
      "clarityScore",
      "weakestDimension",
      "readyForSpec",
      "assumptions",
      "ontologySnapshot",
    ],
  };
}

export function buildAgentPlanningSpecJsonSchema(): Record<string, unknown> {
  const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string", minLength: 1 },
      constraints: stringArraySchema,
      nonGoals: stringArraySchema,
      acceptanceCriteria: stringArraySchema,
      assumptionsResolved: stringArraySchema,
      assumptionLedger: stringArraySchema,
      repoEvidence: stringArraySchema,
      openRisks: stringArraySchema,
    },
    required: [
      "goal",
      "constraints",
      "nonGoals",
      "acceptanceCriteria",
      "assumptionsResolved",
      "assumptionLedger",
      "repoEvidence",
      "openRisks",
    ],
  };
}

export function buildAgentPlanConsensusDraftJsonSchema(): Record<string, unknown> {
  const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };
  const optionSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
    },
    required: ["name", "rationale"],
  };
  const workstreamSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      goal: { type: "string", minLength: 1 },
      targetArtifacts: stringArraySchema,
      requiredChangedPaths: stringArraySchema,
      protectedPaths: stringArraySchema,
      oracleIds: stringArraySchema,
      dependencies: stringArraySchema,
      risks: stringArraySchema,
      disqualifiers: stringArraySchema,
    },
    required: [
      "id",
      "label",
      "goal",
      "targetArtifacts",
      "requiredChangedPaths",
      "protectedPaths",
      "oracleIds",
      "dependencies",
      "risks",
      "disqualifiers",
    ],
  };
  const stageSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      dependsOn: stringArraySchema,
      workstreamIds: stringArraySchema,
      roundIds: stringArraySchema,
      entryCriteria: stringArraySchema,
      exitCriteria: stringArraySchema,
    },
    required: [
      "id",
      "label",
      "dependsOn",
      "workstreamIds",
      "roundIds",
      "entryCriteria",
      "exitCriteria",
    ],
  };
  const scorecardDefinitionSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      dimensions: stringArraySchema,
      abstentionTriggers: stringArraySchema,
    },
    required: ["dimensions", "abstentionTriggers"],
  };
  const repairPolicySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      maxAttemptsPerStage: { type: "integer", minimum: 0 },
      immediateElimination: stringArraySchema,
      repairable: stringArraySchema,
      preferAbstainOverRetry: stringArraySchema,
    },
    required: [
      "maxAttemptsPerStage",
      "immediateElimination",
      "repairable",
      "preferAbstainOverRetry",
    ],
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1 },
      principles: stringArraySchema,
      decisionDrivers: stringArraySchema,
      viableOptions: { type: "array", items: optionSchema },
      selectedOption: optionSchema,
      rejectedAlternatives: { type: "array", items: optionSchema },
      plannedJudgingCriteria: stringArraySchema,
      crownGates: stringArraySchema,
      requiredChangedPaths: stringArraySchema,
      protectedPaths: stringArraySchema,
      workstreams: { type: "array", items: workstreamSchema },
      stagePlan: { type: "array", items: stageSchema },
      scorecardDefinition: scorecardDefinitionSchema,
      repairPolicy: repairPolicySchema,
      assumptionLedger: stringArraySchema,
      premortem: stringArraySchema,
      expandedTestPlan: stringArraySchema,
    },
    required: [
      "summary",
      "principles",
      "decisionDrivers",
      "viableOptions",
      "selectedOption",
      "rejectedAlternatives",
      "plannedJudgingCriteria",
      "crownGates",
      "requiredChangedPaths",
      "protectedPaths",
      "workstreams",
      "stagePlan",
      "scorecardDefinition",
      "repairPolicy",
      "assumptionLedger",
      "premortem",
      "expandedTestPlan",
    ],
  };
}

export function buildAgentPlanConsensusReviewJsonSchema(): Record<string, unknown> {
  const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["approve", "revise", "reject"] },
      summary: { type: "string", minLength: 1 },
      requiredChanges: stringArraySchema,
      tradeoffs: stringArraySchema,
      risks: stringArraySchema,
    },
    required: ["verdict", "summary", "requiredChanges", "tradeoffs", "risks"],
  };
}
