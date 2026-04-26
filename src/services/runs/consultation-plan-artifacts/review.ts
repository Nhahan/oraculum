import type { AgentAdapter } from "../../../adapters/types.js";
import type { ConsultationPlanArtifact, ConsultationPlanReview } from "../../../domain/run.js";
import { consultationPlanReviewSchema } from "../../../domain/run.js";

export async function recommendConsultationPlanReview(options: {
  adapter: AgentAdapter;
  consultationPlan: ConsultationPlanArtifact;
  createdAt: string;
  projectRoot: string;
  reportsDir: string;
  runId: string;
}): Promise<ConsultationPlanReview> {
  if (!options.adapter.recommendPlanReview) {
    return buildFallbackPlanReview(options, "Adapter does not support structured plan review.");
  }

  try {
    const result = await options.adapter.recommendPlanReview({
      consultationPlan: options.consultationPlan,
      logDir: options.reportsDir,
      projectRoot: options.projectRoot,
      runId: options.runId,
    });
    if (result.status === "completed" && result.recommendation) {
      return normalizePlanReviewForReadinessGate(
        consultationPlanReviewSchema.parse({
          runId: options.runId,
          createdAt: options.createdAt,
          ...result.recommendation,
        }),
      );
    }
    return buildFallbackPlanReview(options, result.summary);
  } catch (error) {
    return buildFallbackPlanReview(options, error instanceof Error ? error.message : String(error));
  }
}

function buildFallbackPlanReview(
  options: {
    consultationPlan: ConsultationPlanArtifact;
    createdAt: string;
    runId: string;
  },
  reason: string,
): ConsultationPlanReview {
  const warnings = [`Plan review runtime did not return a usable structured review: ${reason}`];

  return consultationPlanReviewSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    status: "issues",
    summary: "Plan review fallback recorded issues.",
    blockers: [],
    warnings,
    riskFindings: [],
    invariantFindings: [],
    crownGateFindings: [],
    repairPolicyFindings: [],
    scorecardFindings: [],
    nextAction: "Review plan warnings before running `orc consult <plan>`.",
  });
}

function normalizePlanReviewForReadinessGate(
  review: ConsultationPlanReview,
): ConsultationPlanReview {
  if (review.status !== "blocked") {
    return review;
  }

  return consultationPlanReviewSchema.parse({
    ...review,
    status: "issues",
    blockers: [],
    warnings: [
      ...review.warnings,
      ...review.blockers.map((blocker) => `Plan review requested a block: ${blocker}`),
    ],
    nextAction:
      'Review plan findings before consult, or start a new `orc plan "<task>"` with a revised task contract if the task is incomplete.',
  });
}
