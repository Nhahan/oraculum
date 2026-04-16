import type { z } from "zod";

import type { AgentJudgeResult } from "../../adapters/types.js";
import type { secondOpinionJudgeTriggerSchema } from "../../domain/config.js";

import { RunStore } from "../run-store.js";

import { canonicalizeSecondOpinionJudgeResult, runFinalistJudge } from "./runner.js";
import {
  type SecondOpinionAgreement,
  type SecondOpinionPrimaryRecommendation,
  type SecondOpinionWinnerSelectionArtifact,
  secondOpinionAgreementSchema,
  secondOpinionPrimaryRecommendationSchema,
  secondOpinionWinnerSelectionArtifactSchema,
} from "./schema.js";
import { buildJudgableFinalists, type JudgableFinalists } from "./scorecards.js";
import type { RecommendSecondOpinionOptions } from "./shared.js";

export async function recommendSecondOpinionWithJudge(
  options: RecommendSecondOpinionOptions,
): Promise<SecondOpinionWinnerSelectionArtifact | undefined> {
  if (!options.secondOpinion.enabled) {
    return undefined;
  }

  const store = new RunStore(options.projectRoot);
  const projectRoot = store.projectRoot;
  const finalists = await buildJudgableFinalists({
    candidateResults: options.candidateResults,
    candidates: options.candidates,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    projectRoot,
    runId: options.runId,
    verdictsByCandidate: options.verdictsByCandidate,
    ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
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
    ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
    primaryRecommendation,
    ...(options.primaryJudgeResult ? { primaryJudgeResult: options.primaryJudgeResult } : {}),
    secondOpinion: options.secondOpinion,
  });
  if (triggerMatches.length === 0) {
    return undefined;
  }

  let result: AgentJudgeResult | undefined;
  try {
    result = await runFinalistJudge({
      adapter: options.adapter,
      ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
      finalists,
      logDir: store.getRunPaths(options.runId).secondOpinionWinnerJudgeLogsDir,
      projectRoot,
      runId: options.runId,
      taskPacket: options.taskPacket,
      ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
    });
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
  await store.writeJsonArtifact(
    store.getRunPaths(options.runId).secondOpinionWinnerSelectionPath,
    artifact,
  );
  return artifact;
}

function buildPrimaryRecommendation(
  options: Pick<RecommendSecondOpinionOptions, "primaryJudgeResult" | "primaryRecommendation">,
): SecondOpinionPrimaryRecommendation | undefined {
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
  finalists: JudgableFinalists;
  consultationProfile?: RecommendSecondOpinionOptions["consultationProfile"];
  primaryJudgeResult?: RecommendSecondOpinionOptions["primaryJudgeResult"];
  primaryRecommendation: SecondOpinionPrimaryRecommendation;
  secondOpinion: RecommendSecondOpinionOptions["secondOpinion"];
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
  primaryRecommendation: SecondOpinionPrimaryRecommendation,
  result: AgentJudgeResult | undefined,
): SecondOpinionAgreement {
  const recommendation = result?.status === "completed" ? result.recommendation : undefined;
  if (!recommendation) {
    return secondOpinionAgreementSchema.parse("unavailable");
  }

  if (primaryRecommendation.decision === "abstain" && recommendation.decision === "abstain") {
    return secondOpinionAgreementSchema.parse("agrees-abstain");
  }
  if (
    primaryRecommendation.decision === "select" &&
    recommendation.decision === "select" &&
    primaryRecommendation.candidateId === recommendation.candidateId
  ) {
    return secondOpinionAgreementSchema.parse("agrees-select");
  }
  if (primaryRecommendation.decision !== recommendation.decision) {
    return secondOpinionAgreementSchema.parse("disagrees-select-vs-abstain");
  }
  return secondOpinionAgreementSchema.parse("disagrees-candidate");
}

function buildSecondOpinionAdvisorySummary(
  primaryRecommendation: SecondOpinionPrimaryRecommendation,
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
