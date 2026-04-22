import { readFile } from "node:fs/promises";

import { ZodError } from "zod";

import { OraculumError } from "../../../core/errors.js";
import type { ProjectConfig } from "../../../domain/config.js";
import type { ConsultationPlanArtifact, ConsultationPlanReadiness } from "../../../domain/run.js";
import { consultationPlanReadinessSchema } from "../../../domain/run.js";
import { pathExists } from "../../project.js";
import { getConsultationPlanReadinessPathForPlan } from "./readiness.js";

export async function assertConsultationPlanReadyForConsult(options: {
  config: ProjectConfig;
  consultationPlan: ConsultationPlanArtifact;
  planPath: string;
}): Promise<void> {
  const readinessPath = getConsultationPlanReadinessPathForPlan(options.planPath);
  if (!(await pathExists(readinessPath))) {
    throw new OraculumError(
      `Persisted consultation plan "${options.consultationPlan.runId}" is missing plan-readiness.json. Rerun \`orc plan\` before \`orc consult ${options.planPath}\`.`,
    );
  }

  let readiness: ConsultationPlanReadiness;
  try {
    readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(await readFile(readinessPath, "utf8")) as unknown,
    );
  } catch (error) {
    throw new OraculumError(
      `Persisted consultation plan "${options.consultationPlan.runId}" has an invalid plan-readiness.json: ${formatUnknownError(error)}`,
    );
  }

  const blockers = new Set<string>();
  const clarificationReasons = new Set<string>();
  if (readiness.runId !== options.consultationPlan.runId) {
    blockers.add(
      `plan-readiness.json belongs to "${readiness.runId}" instead of "${options.consultationPlan.runId}"`,
    );
  }
  if (!readiness.readyForConsult || !options.consultationPlan.readyForConsult) {
    clarificationReasons.add("the plan still has unanswered clarification");
  }
  if (readiness.status === "blocked") {
    for (const blocker of readiness.blockers) {
      if (isClarificationBlocker(blocker)) {
        clarificationReasons.add(blocker);
      } else {
        blockers.add(blocker);
      }
    }
  }
  if (readiness.staleBasis) {
    blockers.add("plan basis is stale");
  }
  const unresolvedQuestions = dedupeStrings([
    ...readiness.unresolvedQuestions,
    ...options.consultationPlan.openQuestions,
  ]);
  if (unresolvedQuestions.length > 0) {
    clarificationReasons.add(`unresolved questions remain: ${unresolvedQuestions.join(" | ")}`);
  }
  const missingOracleIds = dedupeStrings([
    ...readiness.missingOracleIds,
    ...findMissingPlannedOracleIds(options.consultationPlan, options.config),
  ]);
  if (missingOracleIds.length > 0) {
    blockers.add(`missing planned oracles: ${missingOracleIds.join(", ")}`);
  }

  if (blockers.size > 0) {
    throw new OraculumError(
      `Persisted consultation plan "${options.consultationPlan.runId}" is not ready for consult: ${[
        ...blockers,
      ].join("; ")}. Next action: ${readiness.nextAction}`,
    );
  }
  if (clarificationReasons.size > 0) {
    throw new OraculumError(
      `Persisted consultation plan "${options.consultationPlan.runId}" needs clarification before consult: ${[
        ...clarificationReasons,
      ].join("; ")}. Next action: ${readiness.nextAction}`,
    );
  }
}

function findMissingPlannedOracleIds(
  consultationPlan: ConsultationPlanArtifact,
  config: ProjectConfig,
): string[] {
  const availableOracleIds = new Set(config.oracles.map((oracle) => oracle.id));
  const plannedOracleIds = new Set([
    ...consultationPlan.oracleIds,
    ...(consultationPlan.profileSelection?.oracleIds ?? []),
    ...consultationPlan.workstreams.flatMap((workstream) => workstream.oracleIds),
  ]);

  return [...plannedOracleIds].filter((oracleId) => !availableOracleIds.has(oracleId));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isClarificationBlocker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("clarification") ||
    normalized.includes("answer required") ||
    normalized.includes("unresolved question") ||
    normalized.includes("unanswered") ||
    normalized.includes("readyforconsult=false")
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
