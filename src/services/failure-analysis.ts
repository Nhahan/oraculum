import { z } from "zod";

import { getFailureAnalysisPath } from "../core/paths.js";
import type { OracleVerdict } from "../domain/oracle.js";
import { getValidationGaps } from "../domain/profile.js";
import { candidateStatusSchema, type RunManifest } from "../domain/run.js";

import { writeJsonFile } from "./project.js";

export const failureAnalysisSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  trigger: z.enum([
    "judge-abstained",
    "repair-stalled",
    "validation-gaps",
    "no-survivors",
    "finalists-without-recommendation",
  ]),
  summary: z.string().min(1),
  recommendedAction: z.literal("investigate-root-cause-before-rerun"),
  validationGaps: z.array(z.string().min(1)).default([]),
  candidates: z.array(
    z.object({
      candidateId: z.string().min(1),
      status: candidateStatusSchema,
      repairCount: z.number().int().min(0),
      repairedRounds: z.array(z.string().min(1)).default([]),
      topFailingOracleIds: z.array(z.string().min(1)).default([]),
      keyWitnessTitles: z.array(z.string().min(1)).default([]),
    }),
  ),
});

interface WriteFailureAnalysisOptions {
  judgeAbstained: boolean;
  maxRepairAttemptsPerRound: number;
  manifest: RunManifest;
  projectRoot: string;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}

export async function writeFailureAnalysis(
  options: WriteFailureAnalysisOptions,
): Promise<string | undefined> {
  const outcomeType = options.manifest.outcome?.type;
  if (
    !outcomeType ||
    outcomeType === "recommended-survivor" ||
    outcomeType === "pending-execution" ||
    outcomeType === "running" ||
    outcomeType === "needs-clarification" ||
    outcomeType === "external-research-required" ||
    outcomeType === "abstained-before-execution"
  ) {
    return undefined;
  }

  const validationGaps = getValidationGaps(options.manifest.profileSelection);
  const repairStalled = options.manifest.candidates.some(
    (candidate) =>
      candidate.repairCount >= options.maxRepairAttemptsPerRound &&
      (candidate.status === "failed" || candidate.status === "eliminated"),
  );
  const trigger = options.judgeAbstained
    ? "judge-abstained"
    : repairStalled
      ? "repair-stalled"
      : outcomeType === "completed-with-validation-gaps"
        ? "validation-gaps"
        : outcomeType === "no-survivors"
          ? "no-survivors"
          : "finalists-without-recommendation";

  const summary = buildFailureSummary({
    judgeAbstained: options.judgeAbstained,
    outcomeType,
    repairStalled,
    validationGaps,
  });

  const path = getFailureAnalysisPath(options.projectRoot, options.manifest.id);
  await writeJsonFile(
    path,
    failureAnalysisSchema.parse({
      runId: options.manifest.id,
      generatedAt: new Date().toISOString(),
      trigger,
      summary,
      recommendedAction: "investigate-root-cause-before-rerun",
      validationGaps,
      candidates: options.manifest.candidates.map((candidate) => {
        const verdicts = options.verdictsByCandidate.get(candidate.id) ?? [];
        return {
          candidateId: candidate.id,
          status: candidate.status,
          repairCount: candidate.repairCount ?? 0,
          repairedRounds: candidate.repairedRounds ?? [],
          topFailingOracleIds: [
            ...new Set(
              verdicts
                .filter((verdict) => verdict.status === "repairable" || verdict.status === "fail")
                .map((verdict) => verdict.oracleId),
            ),
          ].slice(0, 5),
          keyWitnessTitles: [
            ...new Set(
              verdicts.flatMap((verdict) => verdict.witnesses.map((witness) => witness.title)),
            ),
          ].slice(0, 5),
        };
      }),
    }),
  );

  return path;
}

function buildFailureSummary(options: {
  judgeAbstained: boolean;
  outcomeType: NonNullable<RunManifest["outcome"]>["type"];
  repairStalled: boolean;
  validationGaps: string[];
}): string {
  if (options.judgeAbstained) {
    return "The finalist judge abstained, so operator investigation is required before any rerun or crowning decision.";
  }

  if (options.repairStalled) {
    return "Repair attempts stalled on failing or repairable oracle evidence; investigate the root cause before retrying.";
  }

  if (options.outcomeType === "completed-with-validation-gaps") {
    return options.validationGaps.length > 0
      ? `Execution completed with unresolved validation gaps: ${options.validationGaps.join("; ")}.`
      : "Execution completed with unresolved validation gaps that require investigation before rerunning.";
  }

  if (options.outcomeType === "no-survivors") {
    return "No finalists survived the oracle rounds; investigate failing oracle evidence before retrying.";
  }

  return "Finalists survived without a recommendation; investigate the strongest and weakest evidence before rerunning or manual crowning.";
}
