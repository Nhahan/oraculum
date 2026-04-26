import type { AgentAdapter } from "../../adapters/types.js";
import {
  type ConsultationPlanArtifact,
  type PlanConsensusArtifact,
  type PlanConsensusDraft,
  type PlanConsensusReview,
  type PlanningSpecArtifact,
  planConsensusArtifactSchema,
  planConsensusDraftSchema,
  planConsensusReviewSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import { writeJsonFile } from "../project.js";
import { RunStore } from "../run-store.js";

export async function buildPlanConsensus(options: {
  adapter: AgentAdapter | undefined;
  basePlan: ConsultationPlanArtifact;
  createdAt: string;
  maxConsensusLoopRevisions: number;
  planningSpec: PlanningSpecArtifact;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanConsensusArtifact> {
  let draft = await draftConsensus(options);
  const revisionHistory: PlanConsensusArtifact["revisionHistory"] = [];
  const criticVerdicts: PlanConsensusReview[] = [];
  const architectAntithesis = new Set<string>();
  let approved = false;

  for (let revision = 0; revision <= options.maxConsensusLoopRevisions; revision += 1) {
    const architectReview = await reviewConsensus({
      ...options,
      draft,
      reviewer: "architect",
    });
    const criticReview = await reviewConsensus({
      ...options,
      draft,
      reviewer: "critic",
    });
    criticVerdicts.push(criticReview);
    for (const tradeoff of architectReview.tradeoffs) {
      architectAntithesis.add(tradeoff);
    }
    revisionHistory.push({
      revision: revision + 1,
      summary: summarizeRevision(architectReview, criticReview),
      architectReview,
      criticReview,
    });

    if (hasTaskClarificationQuestion(architectReview, criticReview)) {
      break;
    }
    if (architectReview.verdict === "approve" && criticReview.verdict === "approve") {
      approved = true;
      break;
    }
    if (architectReview.verdict === "reject" || criticReview.verdict === "reject") {
      break;
    }
    if (revision >= options.maxConsensusLoopRevisions) {
      break;
    }

    draft = await reviseConsensus({
      ...options,
      architectReview,
      criticReview,
      draft,
      revision: revision + 1,
    });
  }

  return planConsensusArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    approved,
    maxRevisions: options.maxConsensusLoopRevisions,
    principles: draft.principles,
    decisionDrivers: draft.decisionDrivers,
    viableOptions: draft.viableOptions,
    selectedOption: draft.selectedOption,
    rejectedAlternatives: draft.rejectedAlternatives,
    architectAntithesis: [...architectAntithesis],
    criticVerdicts,
    revisionHistory,
    finalDraft: draft,
  });
}

export interface PlanConsensusBlockerSummary {
  blockerKind: "task-clarification" | "rejected" | "revision-cap" | "runtime-unavailable";
  summary: string;
  clarificationQuestion: string;
  clarityGateSummary: string;
  openQuestion: string;
  requiredChanges: string[];
  taskClarificationQuestion?: string;
}

export function applyPlanConsensusToConsultationPlan(
  plan: ConsultationPlanArtifact,
  consensus: PlanConsensusArtifact,
  paths: {
    planningInterviewPath?: string;
    planningSpecPath: string;
    planConsensusPath: string;
  },
): ConsultationPlanArtifact {
  const draft = consensus.finalDraft;
  const blocker = consensus.approved ? undefined : summarizePlanConsensusBlocker(consensus);

  return {
    ...plan,
    readyForConsult: plan.readyForConsult && consensus.approved,
    decisionDrivers:
      draft.decisionDrivers.length > 0 ? draft.decisionDrivers : plan.decisionDrivers,
    plannedJudgingCriteria:
      draft.plannedJudgingCriteria.length > 0
        ? draft.plannedJudgingCriteria
        : plan.plannedJudgingCriteria,
    crownGates: draft.crownGates.length > 0 ? draft.crownGates : plan.crownGates,
    requiredChangedPaths:
      draft.requiredChangedPaths.length > 0
        ? draft.requiredChangedPaths
        : plan.requiredChangedPaths,
    protectedPaths: draft.protectedPaths,
    workstreams: draft.workstreams.length > 0 ? draft.workstreams : plan.workstreams,
    stagePlan: draft.stagePlan.length > 0 ? draft.stagePlan : plan.stagePlan,
    ...(draft.scorecardDefinition ? { scorecardDefinition: draft.scorecardDefinition } : {}),
    ...(draft.repairPolicy ? { repairPolicy: draft.repairPolicy } : {}),
    planningSpecPath: paths.planningSpecPath,
    ...(paths.planningInterviewPath ? { planningInterviewPath: paths.planningInterviewPath } : {}),
    planConsensusPath: paths.planConsensusPath,
    selectedApproach: consensus.selectedOption.name,
    rejectedApproaches: consensus.rejectedAlternatives.map((option) => option.name),
    assumptionLedger: draft.assumptionLedger,
    premortem: draft.premortem,
    expandedTestPlan: draft.expandedTestPlan,
    clarityGate: {
      status: consensus.approved ? "clear" : "blocked",
      summary: consensus.approved
        ? "Consensus review approved the plan."
        : (blocker?.clarityGateSummary ??
          "Consensus review did not approve before the revision cap."),
    },
    openQuestions:
      consensus.approved || !blocker?.taskClarificationQuestion
        ? plan.openQuestions
        : [...plan.openQuestions, blocker.taskClarificationQuestion],
  };
}

export function summarizePlanConsensusBlocker(consensus: PlanConsensusArtifact): {
  blockerKind: "task-clarification" | "rejected" | "revision-cap" | "runtime-unavailable";
  summary: string;
  clarificationQuestion: string;
  clarityGateSummary: string;
  openQuestion: string;
  requiredChanges: string[];
  taskClarificationQuestion?: string;
} {
  const reviews = consensus.revisionHistory.flatMap((revision) =>
    [revision.architectReview, revision.criticReview].filter(
      (review): review is PlanConsensusReview => Boolean(review),
    ),
  );
  const taskClarificationReview = reviews.find((review) => review.taskClarificationQuestion);
  if (taskClarificationReview?.taskClarificationQuestion) {
    return {
      blockerKind: "task-clarification",
      summary:
        "Plan Conclave found that user intent is still too unclear for candidate generation.",
      clarificationQuestion: taskClarificationReview.taskClarificationQuestion,
      clarityGateSummary: `Plan Conclave requested Augury clarification: ${taskClarificationReview.summary}`,
      openQuestion: taskClarificationReview.taskClarificationQuestion,
      requiredChanges: collectRequiredChanges([taskClarificationReview]),
      taskClarificationQuestion: taskClarificationReview.taskClarificationQuestion,
    };
  }
  const runtimeUnavailableReview = reviews.find((review) =>
    [review.summary, ...review.requiredChanges].some((value) =>
      value.toLowerCase().includes("runtime unavailable"),
    ),
  );
  if (runtimeUnavailableReview) {
    return {
      blockerKind: "runtime-unavailable",
      summary:
        "Plan Conclave review runtime unavailable. Rerun planning when architect/critic review can execute.",
      clarificationQuestion:
        "Plan Conclave review runtime unavailable. Rerun planning when architect/critic review can execute.",
      clarityGateSummary: "Plan Conclave review runtime unavailable.",
      openQuestion:
        "Plan Conclave review runtime unavailable. Rerun planning when architect/critic review can execute.",
      requiredChanges: collectRequiredChanges([runtimeUnavailableReview]),
    };
  }

  const rejectedReview = reviews.find((review) => review.verdict === "reject");
  if (rejectedReview) {
    return {
      blockerKind: "rejected",
      summary: "Plan Conclave rejected the explicit consultation plan before candidate generation.",
      clarificationQuestion:
        "Plan Conclave rejected the draft; address the review finding and rerun planning.",
      clarityGateSummary: `Plan Conclave rejected the draft: ${rejectedReview.summary}`,
      openQuestion:
        "Plan Conclave rejected the draft; address the review finding and rerun planning.",
      requiredChanges: collectRequiredChanges(
        reviews.filter((review) => review.verdict === "reject"),
      ),
    };
  }

  return {
    blockerKind: "revision-cap",
    summary:
      "Consensus review did not approve the explicit consultation plan before the configured revision cap.",
    clarificationQuestion:
      "Consensus review did not approve before the revision cap; revise the task contract or rerun planning.",
    clarityGateSummary: "Consensus review did not approve before the revision cap.",
    openQuestion:
      "Consensus review did not approve before the revision cap; revise the task contract or rerun planning.",
    requiredChanges: collectRequiredChanges(getLatestRevisionReviews(consensus)),
  };
}

function collectRequiredChanges(reviews: PlanConsensusReview[]): string[] {
  return [
    ...new Set(
      reviews.flatMap((review) =>
        review.requiredChanges.length > 0 ? review.requiredChanges : [review.summary],
      ),
    ),
  ];
}

function getLatestRevisionReviews(consensus: PlanConsensusArtifact): PlanConsensusReview[] {
  const latestRevision = consensus.revisionHistory.at(-1);
  if (!latestRevision) {
    return [];
  }

  return [latestRevision.architectReview, latestRevision.criticReview].filter(
    (review): review is PlanConsensusReview => Boolean(review),
  );
}

export async function writePlanConsensusArtifact(options: {
  consensus: PlanConsensusArtifact;
  projectRoot: string;
  runId: string;
}): Promise<void> {
  const runPaths = new RunStore(options.projectRoot).getRunPaths(options.runId);
  await writeJsonFile(runPaths.planConsensusPath, options.consensus);
}

async function draftConsensus(options: {
  adapter: AgentAdapter | undefined;
  basePlan: ConsultationPlanArtifact;
  planningSpec: PlanningSpecArtifact;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanConsensusDraft> {
  if (options.adapter?.draftConsensusConsultationPlan) {
    try {
      const result = await options.adapter.draftConsensusConsultationPlan({
        consultationPlan: options.basePlan,
        logDir: options.reportsDir,
        planningSpec: options.planningSpec,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        return result.recommendation;
      }
    } catch {
      // Fall back to deterministic draft.
    }
  }

  return buildFallbackDraft(options.basePlan, options.planningSpec);
}

async function reviewConsensus(options: {
  adapter: AgentAdapter | undefined;
  draft: PlanConsensusDraft;
  planningSpec: PlanningSpecArtifact;
  projectRoot: string;
  reportsDir: string;
  reviewer: "architect" | "critic";
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanConsensusReview> {
  const method =
    options.reviewer === "architect"
      ? options.adapter?.reviewPlanArchitecture
      : options.adapter?.reviewPlanCritic;
  if (method) {
    try {
      const result = await method.call(options.adapter, {
        draft: options.draft,
        logDir: options.reportsDir,
        planningSpec: options.planningSpec,
        projectRoot: options.projectRoot,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        return planConsensusReviewSchema.parse({
          reviewer: options.reviewer,
          ...result.recommendation,
        });
      }
    } catch {
      // Fall through to conservative rejection for runtime-unavailable review.
    }
  }

  return planConsensusReviewSchema.parse({
    reviewer: options.reviewer,
    verdict: "reject",
    summary: "Plan Conclave review runtime unavailable. Rerun planning when review can execute.",
    requiredChanges: [
      "Plan Conclave review runtime unavailable; rerun planning when review can execute.",
    ],
    tradeoffs: [],
    risks: [],
  });
}

function summarizeRevision(
  architectReview: PlanConsensusReview,
  criticReview: PlanConsensusReview,
): string {
  if (hasTaskClarificationQuestion(architectReview, criticReview)) {
    return "Plan Conclave requested Augury clarification.";
  }
  if (architectReview.verdict === "approve" && criticReview.verdict === "approve") {
    return "Architect and critic approved the draft.";
  }
  if (architectReview.verdict === "reject" || criticReview.verdict === "reject") {
    return "Plan Conclave review rejected the draft.";
  }
  return "Consensus review requested revision.";
}

function hasTaskClarificationQuestion(...reviews: PlanConsensusReview[]): boolean {
  return reviews.some((review) => Boolean(review.taskClarificationQuestion));
}

async function reviseConsensus(options: {
  adapter: AgentAdapter | undefined;
  architectReview: PlanConsensusReview;
  criticReview: PlanConsensusReview;
  draft: PlanConsensusDraft;
  planningSpec: PlanningSpecArtifact;
  projectRoot: string;
  reportsDir: string;
  revision: number;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}): Promise<PlanConsensusDraft> {
  if (options.adapter?.reviseConsensusConsultationPlan) {
    try {
      const result = await options.adapter.reviseConsensusConsultationPlan({
        architectReview: options.architectReview,
        criticReview: options.criticReview,
        draft: options.draft,
        logDir: options.reportsDir,
        planningSpec: options.planningSpec,
        projectRoot: options.projectRoot,
        revision: options.revision,
        runId: options.runId,
        taskPacket: options.taskPacket,
      });
      if (result.status === "completed" && result.recommendation) {
        return result.recommendation;
      }
    } catch {
      // Keep current draft if revision fails.
    }
  }

  return planConsensusDraftSchema.parse({
    ...options.draft,
    premortem: [
      ...options.draft.premortem,
      ...options.architectReview.requiredChanges,
      ...options.criticReview.requiredChanges,
    ],
  });
}

function buildFallbackDraft(
  basePlan: ConsultationPlanArtifact,
  planningSpec: PlanningSpecArtifact,
): PlanConsensusDraft {
  return planConsensusDraftSchema.parse({
    summary: "Fallback consensus draft derived from the planning spec and base plan.",
    principles: ["Preserve the planning spec as the execution contract."],
    decisionDrivers:
      basePlan.decisionDrivers.length > 0
        ? basePlan.decisionDrivers
        : [`Goal: ${planningSpec.goal}`],
    viableOptions: [
      {
        name: "spec-first consultation",
        rationale: "Use the crystallized planning spec as the candidate contract.",
      },
    ],
    selectedOption: {
      name: "spec-first consultation",
      rationale: "It carries the clearest available task contract into candidate execution.",
    },
    rejectedAlternatives: [],
    plannedJudgingCriteria:
      basePlan.plannedJudgingCriteria.length > 0
        ? basePlan.plannedJudgingCriteria
        : planningSpec.acceptanceCriteria,
    crownGates: basePlan.crownGates,
    requiredChangedPaths: basePlan.requiredChangedPaths,
    protectedPaths: basePlan.protectedPaths,
    workstreams: basePlan.workstreams,
    stagePlan: basePlan.stagePlan,
    scorecardDefinition: basePlan.scorecardDefinition,
    repairPolicy: basePlan.repairPolicy,
    assumptionLedger: planningSpec.assumptionLedger,
    premortem: planningSpec.openRisks,
    expandedTestPlan: planningSpec.acceptanceCriteria,
  });
}
