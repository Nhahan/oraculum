import { dirname, join } from "node:path";

import type {
  ConsultationPlanArtifact,
  ConsultationPlanReadiness,
  ConsultationPlanReview,
} from "../../../domain/run.js";
import { consultationPlanReadinessSchema } from "../../../domain/run.js";

export const CONSULTATION_PLAN_READINESS_FILENAME = "plan-readiness.json";
export const CONSULTATION_PLAN_REVIEW_FILENAME = "plan-review.json";

export function getConsultationPlanReadinessPathForPlan(planPath: string): string {
  return join(dirname(planPath), CONSULTATION_PLAN_READINESS_FILENAME);
}

export function buildConsultationPlanReadiness(options: {
  consultationPlan: ConsultationPlanArtifact;
  missingOracleIds?: string[];
  review?: ConsultationPlanReview;
  staleBasis?: boolean;
}): ConsultationPlanReadiness {
  const blockers = new Set<string>();
  const warnings = new Set<string>();
  const missingOracleIds = dedupeStrings(options.missingOracleIds ?? []);
  const unresolvedQuestions = dedupeStrings(options.consultationPlan.openQuestions);
  const staleBasis = options.staleBasis ?? false;
  const reviewStatus = options.review?.status ?? "not-run";

  const needsClarification =
    !options.consultationPlan.readyForConsult || unresolvedQuestions.length > 0;

  if (staleBasis) {
    blockers.add("plan basis is stale");
  }
  if (missingOracleIds.length > 0) {
    blockers.add(`missing planned oracles: ${missingOracleIds.join(", ")}`);
  }
  if (reviewStatus === "blocked") {
    warnings.add("plan review requested blocking treatment; recorded as advisory.");
  }
  for (const blocker of options.review?.blockers ?? []) {
    warnings.add(`plan review finding: ${blocker}`);
  }
  if (reviewStatus === "issues") {
    warnings.add("plan review recorded issues");
  }
  for (const warning of options.review?.warnings ?? []) {
    warnings.add(warning);
  }

  const readyForConsult = blockers.size === 0 && !needsClarification;
  const status =
    blockers.size > 0
      ? "blocked"
      : needsClarification
        ? "needs-clarification"
        : warnings.size > 0
          ? "issues"
          : "clear";

  return consultationPlanReadinessSchema.parse({
    runId: options.consultationPlan.runId,
    status,
    readyForConsult,
    blockers: [...blockers],
    warnings: [...warnings],
    staleBasis,
    missingOracleIds,
    unresolvedQuestions,
    reviewStatus,
    nextAction: buildReadinessNextAction({
      consultationPlan: options.consultationPlan,
      readyForConsult,
      ...(options.review ? { review: options.review } : {}),
    }),
  });
}

function buildReadinessNextAction(options: {
  consultationPlan: ConsultationPlanArtifact;
  readyForConsult: boolean;
  review?: ConsultationPlanReview;
}): string {
  if (options.readyForConsult) {
    return options.consultationPlan.recommendedNextAction;
  }
  if (options.consultationPlan.openQuestions.length > 0) {
    return 'Answer the unresolved plan questions, then rerun `orc plan "<task plus the answer>"`.';
  }
  return "Refresh the consultation plan before running `orc consult <plan>`.";
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
