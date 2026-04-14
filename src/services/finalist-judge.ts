import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { AgentAdapter, AgentJudgeResult, AgentRunResult } from "../adapters/types.js";
import { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getSecondOpinionWinnerJudgeLogsDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerJudgeLogsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import {
  adapterSchema,
  type ManagedTreeRules,
  type SecondOpinionJudgeConfig,
  secondOpinionJudgeTriggerSchema,
} from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import type { ConsultationProfileSelection } from "../domain/profile.js";
import {
  type CandidateManifest,
  type RunRecommendation,
  runRecommendationSchema,
} from "../domain/run.js";
import { materializedTaskPacketSchema } from "../domain/task.js";

import { buildEnrichedFinalistSummaries } from "./finalist-insights.js";
import { writeJsonFile } from "./project.js";

interface RecommendWinnerOptions {
  adapter: AgentAdapter;
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  projectRoot: string;
  runId: string;
  taskPacket: unknown;
  managedTreeRules?: ManagedTreeRules;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
  consultationProfile?: ConsultationProfileSelection;
}

export interface WinnerJudgeOutcome {
  fallbackAllowed: boolean;
  judgeResult?: AgentJudgeResult;
  recommendation?: RunRecommendation;
}

const secondOpinionPrimaryRecommendationSchema = z
  .object({
    source: z.enum(["llm-judge", "fallback-policy"]),
    decision: z.enum(["select", "abstain"]),
    candidateId: z.string().min(1).optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    summary: z.string().min(1),
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

export const secondOpinionAgreementSchema = z.enum([
  "agrees-select",
  "agrees-abstain",
  "disagrees-candidate",
  "disagrees-select-vs-abstain",
  "unavailable",
]);

export const secondOpinionWinnerSelectionArtifactSchema = z
  .object({
    runId: z.string().min(1),
    advisoryOnly: z.literal(true),
    adapter: adapterSchema,
    triggerKinds: z.array(secondOpinionJudgeTriggerSchema).min(1),
    triggerReasons: z.array(z.string().min(1)).min(1),
    primaryRecommendation: secondOpinionPrimaryRecommendationSchema,
    result: agentJudgeResultSchema.optional(),
    agreement: secondOpinionAgreementSchema,
    advisorySummary: z.string().min(1),
  })
  .superRefine((value, context) => {
    const recommendation =
      value.result?.status === "completed" ? value.result.recommendation : undefined;

    if (value.triggerKinds.length !== value.triggerReasons.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerReasons"],
        message:
          "triggerReasons must align 1:1 with triggerKinds in the persisted second-opinion artifact.",
      });
    }

    if (value.agreement === "unavailable") {
      if (value.result) {
        if (value.result.runId !== value.runId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "runId"],
            message: "result.runId must match the persisted second-opinion artifact runId.",
          });
        }
        if (value.result.adapter !== value.adapter) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "adapter"],
            message: "result.adapter must match the persisted second-opinion artifact adapter.",
          });
        }
        if (value.result.status === "completed") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "status"],
            message:
              "result.status cannot be completed when second-opinion agreement is unavailable.",
          });
        }
        if ("recommendation" in value.result && value.result.recommendation !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "recommendation"],
            message:
              "result.recommendation must be omitted when second-opinion agreement is unavailable.",
          });
        }
      }
      return;
    }

    if (!value.result) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "result is required when second-opinion agreement is available.",
      });
      return;
    }

    if (value.result.status !== "completed") {
      if (value.result.runId !== value.runId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["result", "runId"],
          message: "result.runId must match the persisted second-opinion artifact runId.",
        });
      }
      if (value.result.adapter !== value.adapter) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["result", "adapter"],
          message: "result.adapter must match the persisted second-opinion artifact adapter.",
        });
      }
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "status"],
        message: "result.status must be completed when second-opinion agreement is available.",
      });
      return;
    }

    if (!recommendation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "recommendation"],
        message: "result.recommendation is required when second-opinion agreement is available.",
      });
      return;
    }

    if (value.result.runId !== value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "runId"],
        message: "result.runId must match the persisted second-opinion artifact runId.",
      });
    }

    if (value.result.adapter !== value.adapter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "adapter"],
        message: "result.adapter must match the persisted second-opinion artifact adapter.",
      });
    }

    switch (value.agreement) {
      case "agrees-select":
        if (
          value.primaryRecommendation.decision !== "select" ||
          recommendation.decision !== "select" ||
          value.primaryRecommendation.candidateId !== recommendation.candidateId
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message: "agrees-select requires both recommendations to select the same candidate.",
          });
        }
        return;
      case "agrees-abstain":
        if (
          value.primaryRecommendation.decision !== "abstain" ||
          recommendation.decision !== "abstain"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message: "agrees-abstain requires both recommendations to abstain.",
          });
        }
        return;
      case "disagrees-candidate":
        if (
          value.primaryRecommendation.decision !== "select" ||
          recommendation.decision !== "select" ||
          value.primaryRecommendation.candidateId === recommendation.candidateId
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message:
              "disagrees-candidate requires both recommendations to select different candidates.",
          });
        }
        return;
      case "disagrees-select-vs-abstain":
        if (value.primaryRecommendation.decision === recommendation.decision) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message:
              "disagrees-select-vs-abstain requires one recommendation to select and the other to abstain.",
          });
        }
        return;
    }
  });

interface RecommendSecondOpinionOptions {
  adapter: AgentAdapter;
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  consultationProfile?: ConsultationProfileSelection;
  managedTreeRules?: ManagedTreeRules;
  primaryJudgeResult?: AgentJudgeResult;
  primaryRecommendation?: RunRecommendation;
  projectRoot: string;
  runId: string;
  secondOpinion: SecondOpinionJudgeConfig;
  taskPacket: unknown;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}

export async function recommendWinnerWithJudge(
  options: RecommendWinnerOptions,
): Promise<WinnerJudgeOutcome> {
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    verdictsByCandidate: options.verdictsByCandidate,
  });
  if (finalists.length === 0) {
    return { fallbackAllowed: false };
  }

  const taskPacket = materializedTaskPacketSchema.parse(options.taskPacket);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const logDir = getWinnerJudgeLogsDir(projectRoot, options.runId);
  await mkdir(logDir, { recursive: true });
  const persistedResultPath = getWinnerSelectionPath(projectRoot, options.runId);

  let judgeResult: AgentJudgeResult;
  try {
    judgeResult = agentJudgeResultSchema.parse(
      await options.adapter.recommendWinner({
        runId: options.runId,
        projectRoot,
        logDir,
        taskPacket,
        finalists,
        ...(options.consultationProfile
          ? {
              consultationProfile: {
                confidence: options.consultationProfile.confidence,
                validationProfileId: options.consultationProfile.validationProfileId,
                validationSummary: options.consultationProfile.validationSummary,
                validationSignals: options.consultationProfile.validationSignals,
                validationGaps: options.consultationProfile.validationGaps,
              },
            }
          : {}),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJudgeWarning(
      persistedResultPath,
      `Winner selection judge failed to start or complete: ${message}`,
    );
    return { fallbackAllowed: true };
  }

  await writeJsonFile(persistedResultPath, judgeResult);

  if (judgeResult.status !== "completed") {
    await writeJudgeWarning(
      persistedResultPath,
      `Winner selection judge status was "${judgeResult.status}", so the deterministic fallback policy was used instead.`,
    );
    return { fallbackAllowed: true, judgeResult };
  }

  const recommendation = judgeResult.recommendation;
  if (!recommendation) {
    await writeJudgeWarning(
      persistedResultPath,
      "Winner selection judge did not return a structured recommendation, so the deterministic fallback policy was used instead.",
    );
    return { fallbackAllowed: true, judgeResult };
  }

  if (recommendation.decision === "abstain") {
    return { fallbackAllowed: false, judgeResult };
  }

  const matchingFinalist = finalists.find(
    (finalist) => finalist.candidateId === recommendation.candidateId,
  );
  if (!matchingFinalist) {
    await writeJudgeWarning(
      persistedResultPath,
      `Judge returned unknown candidate "${recommendation.candidateId}".`,
    );
    return { fallbackAllowed: true, judgeResult };
  }

  return {
    fallbackAllowed: false,
    judgeResult,
    recommendation: runRecommendationSchema.parse({
      candidateId: recommendation.candidateId,
      confidence: recommendation.confidence,
      summary: recommendation.summary,
      source: "llm-judge",
    }),
  };
}

export async function recommendSecondOpinionWithJudge(
  options: RecommendSecondOpinionOptions,
): Promise<z.infer<typeof secondOpinionWinnerSelectionArtifactSchema> | undefined> {
  if (!options.secondOpinion.enabled) {
    return undefined;
  }

  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    verdictsByCandidate: options.verdictsByCandidate,
  });
  if (finalists.length === 0) {
    return undefined;
  }

  const primaryRecommendation = buildPrimaryRecommendation(options);
  if (!primaryRecommendation) {
    return undefined;
  }

  const triggerMatches = collectSecondOpinionTriggerMatches({
    finalists,
    primaryRecommendation,
    secondOpinion: options.secondOpinion,
    ...(options.primaryJudgeResult ? { primaryJudgeResult: options.primaryJudgeResult } : {}),
    ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
  });
  if (triggerMatches.length === 0) {
    return undefined;
  }

  const taskPacket = materializedTaskPacketSchema.parse(options.taskPacket);
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const logDir = getSecondOpinionWinnerJudgeLogsDir(projectRoot, options.runId);
  await mkdir(logDir, { recursive: true });

  let result: AgentJudgeResult | undefined;
  try {
    result = agentJudgeResultSchema.parse(
      await options.adapter.recommendWinner({
        runId: options.runId,
        projectRoot,
        logDir,
        taskPacket,
        finalists,
        ...(options.consultationProfile
          ? {
              consultationProfile: {
                confidence: options.consultationProfile.confidence,
                validationProfileId: options.consultationProfile.validationProfileId,
                validationSummary: options.consultationProfile.validationSummary,
                validationSignals: options.consultationProfile.validationSignals,
                validationGaps: options.consultationProfile.validationGaps,
              },
            }
          : {}),
      }),
    );
  } catch {
    result = undefined;
  }

  const canonicalResult = canonicalizeSecondOpinionJudgeResult(result);

  const artifact = secondOpinionWinnerSelectionArtifactSchema.parse({
    runId: options.runId,
    advisoryOnly: true,
    adapter: options.adapter.name,
    triggerKinds: triggerMatches.map((match) => match.kind),
    triggerReasons: triggerMatches.map((match) => match.reason),
    primaryRecommendation,
    ...(canonicalResult ? { result: canonicalResult } : {}),
    agreement: deriveSecondOpinionAgreement(primaryRecommendation, canonicalResult),
    advisorySummary: buildSecondOpinionAdvisorySummary(primaryRecommendation, canonicalResult),
  });
  await writeJsonFile(getSecondOpinionWinnerSelectionPath(projectRoot, options.runId), artifact);
  return artifact;
}

async function writeJudgeWarning(resultPath: string, message: string): Promise<void> {
  await writeFile(`${resultPath}.warning.txt`, `${message}\n`, "utf8");
}

function canonicalizeSecondOpinionJudgeResult(
  result: AgentJudgeResult | undefined,
): AgentJudgeResult | undefined {
  if (!result || result.status === "completed") {
    return result;
  }

  const { recommendation: _ignoredRecommendation, ...rest } = result;
  return agentJudgeResultSchema.parse(rest);
}

function buildPrimaryRecommendation(
  options: Pick<RecommendSecondOpinionOptions, "primaryJudgeResult" | "primaryRecommendation">,
): z.infer<typeof secondOpinionPrimaryRecommendationSchema> | undefined {
  const primaryJudgeRecommendation = options.primaryJudgeResult?.recommendation;
  if (primaryJudgeRecommendation?.decision === "abstain") {
    return secondOpinionPrimaryRecommendationSchema.parse({
      source: "llm-judge",
      decision: "abstain",
      confidence: primaryJudgeRecommendation.confidence,
      summary: primaryJudgeRecommendation.summary,
    });
  }

  if (options.primaryRecommendation) {
    return secondOpinionPrimaryRecommendationSchema.parse({
      source: options.primaryRecommendation.source,
      decision: "select",
      candidateId: options.primaryRecommendation.candidateId,
      confidence: options.primaryRecommendation.confidence,
      summary: options.primaryRecommendation.summary,
    });
  }

  return undefined;
}

function collectSecondOpinionTriggerMatches(options: {
  finalists: Awaited<ReturnType<typeof buildEnrichedFinalistSummaries>>;
  primaryJudgeResult?: AgentJudgeResult;
  primaryRecommendation: z.infer<typeof secondOpinionPrimaryRecommendationSchema>;
  secondOpinion: SecondOpinionJudgeConfig;
  consultationProfile?: ConsultationProfileSelection;
}): Array<{
  kind: z.infer<typeof secondOpinionJudgeTriggerSchema>;
  reason: string;
}> {
  const matches: Array<{
    kind: z.infer<typeof secondOpinionJudgeTriggerSchema>;
    reason: string;
  }> = [];
  const changedPathCount = Math.max(
    ...options.finalists.map((item) => item.changeSummary.changedPathCount),
  );
  const changedLineCount = Math.max(
    ...options.finalists.map(
      (item) =>
        (item.changeSummary.addedLineCount ?? 0) + (item.changeSummary.deletedLineCount ?? 0),
    ),
  );
  const hasWarningEvidence = options.finalists.some(
    (item) =>
      item.witnessRollup.warningOrHigherCount > 0 ||
      item.witnessRollup.repairableCount > 0 ||
      item.verdicts.some((verdict) => verdict.severity !== "info" || verdict.status !== "pass"),
  );

  for (const trigger of options.secondOpinion.triggers) {
    switch (trigger) {
      case "judge-abstain":
        if (options.primaryJudgeResult?.recommendation?.decision === "abstain") {
          matches.push({
            kind: trigger,
            reason: "Primary finalist judge abstained on the current finalists.",
          });
        }
        break;
      case "low-confidence":
        if (options.primaryRecommendation.confidence === "low") {
          matches.push({
            kind: trigger,
            reason: "Primary finalist recommendation is low-confidence.",
          });
        }
        break;
      case "fallback-policy":
        if (options.primaryRecommendation.source === "fallback-policy") {
          matches.push({
            kind: trigger,
            reason: "Primary recommendation came from deterministic fallback policy.",
          });
        }
        break;
      case "validation-gaps":
        if ((options.consultationProfile?.validationGaps.length ?? 0) > 0) {
          matches.push({
            kind: trigger,
            reason: "Validation gaps remain in the selected consultation posture.",
          });
        }
        break;
      case "many-changed-paths":
        if (changedPathCount >= options.secondOpinion.minChangedPaths) {
          matches.push({
            kind: trigger,
            reason: `A finalist changed ${changedPathCount} paths, meeting the second-opinion threshold (${options.secondOpinion.minChangedPaths}).`,
          });
        }
        break;
      case "large-diff":
        if (changedLineCount >= options.secondOpinion.minChangedLines) {
          matches.push({
            kind: trigger,
            reason: `A finalist changed ${changedLineCount} lines, meeting the second-opinion threshold (${options.secondOpinion.minChangedLines}).`,
          });
        }
        break;
      case "warning-evidence":
        if (hasWarningEvidence) {
          matches.push({
            kind: trigger,
            reason: "Promoted finalists still carry warning-or-higher evidence or repair signals.",
          });
        }
        break;
    }
  }

  return matches;
}

function deriveSecondOpinionAgreement(
  primaryRecommendation: z.infer<typeof secondOpinionPrimaryRecommendationSchema>,
  result: AgentJudgeResult | undefined,
): z.infer<typeof secondOpinionAgreementSchema> {
  const recommendation = result?.status === "completed" ? result.recommendation : undefined;
  if (!recommendation) {
    return "unavailable";
  }

  if (primaryRecommendation.decision === "abstain" && recommendation.decision === "abstain") {
    return "agrees-abstain";
  }
  if (
    primaryRecommendation.decision === "select" &&
    recommendation.decision === "select" &&
    primaryRecommendation.candidateId === recommendation.candidateId
  ) {
    return "agrees-select";
  }
  if (primaryRecommendation.decision !== recommendation.decision) {
    return "disagrees-select-vs-abstain";
  }
  return "disagrees-candidate";
}

function buildSecondOpinionAdvisorySummary(
  primaryRecommendation: z.infer<typeof secondOpinionPrimaryRecommendationSchema>,
  result: AgentJudgeResult | undefined,
): string {
  const recommendation = result?.status === "completed" ? result.recommendation : undefined;
  if (!result) {
    return "Second-opinion judge did not produce a usable advisory result.";
  }
  if (result.status !== "completed") {
    return `Second-opinion judge status was "${result.status}", so no advisory recommendation was recorded.`;
  }
  if (!recommendation) {
    return "Second-opinion judge completed, but no structured advisory recommendation was recorded.";
  }
  const agreement = deriveSecondOpinionAgreement(primaryRecommendation, result);
  switch (agreement) {
    case "agrees-select":
      return `Second-opinion judge agreed with the primary recommendation to select ${recommendation.candidateId}.`;
    case "agrees-abstain":
      return "Second-opinion judge agreed that no finalist should be recommended yet.";
    case "disagrees-candidate":
      return `Second-opinion judge selected ${recommendation.candidateId}, which differs from the primary recommendation for ${primaryRecommendation.candidateId}.`;
    case "disagrees-select-vs-abstain":
      return primaryRecommendation.decision === "abstain"
        ? `Second-opinion judge selected ${recommendation.candidateId}, while the primary judge abstained.`
        : "Second-opinion judge abstained, while the primary path selected a finalist.";
    case "unavailable":
      return "Second-opinion judge did not produce a usable advisory result.";
  }
}
