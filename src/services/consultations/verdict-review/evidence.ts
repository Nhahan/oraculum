import type { VerdictReviewEvidenceOptions } from "./types.js";

export function buildReviewStrongestEvidence(options: VerdictReviewEvidenceOptions): string[] {
  const evidence: string[] = [];
  const add = (item: string | undefined) => {
    if (item && !evidence.includes(item)) {
      evidence.push(item);
    }
  };

  add(options.validationSummary);
  for (const signal of options.validationSignals.slice(0, 3)) {
    add(`Validation evidence: ${signal}`);
  }
  if (options.clarifyFollowUp) {
    add(options.clarifyFollowUp.summary);
    add(`Key clarify question: ${options.clarifyFollowUp.keyQuestion}`);
  }
  if (options.manifest.taskPacket.researchContext?.summary) {
    add(options.manifest.taskPacket.researchContext.summary);
  }
  if (
    options.secondOpinionWinnerSelection &&
    (options.secondOpinionWinnerSelection.agreement === "agrees-select" ||
      options.secondOpinionWinnerSelection.agreement === "agrees-abstain")
  ) {
    add(options.secondOpinionWinnerSelection.advisorySummary);
  }
  if (options.status.outcomeType === "recommended-survivor") {
    add(options.comparisonReport?.whyThisWon);
    add(options.manifest.recommendedWinner?.summary);
    const recommendedFinalist = options.comparisonReport?.finalists.find(
      (finalist) => finalist.candidateId === options.status.recommendedCandidateId,
    );
    add(recommendedFinalist?.summary);
  } else if (
    options.status.outcomeType === "finalists-without-recommendation" &&
    options.reviewFinalistIds.length > 0
  ) {
    add(
      `${options.reviewFinalistIds.length} finalist${options.reviewFinalistIds.length === 1 ? "" : "s"} survived the oracle rounds.`,
    );
  }

  return evidence;
}

export function buildReviewWeakestEvidence(options: VerdictReviewEvidenceOptions): string[] {
  const evidence: string[] = [];
  const add = (item: string | undefined) => {
    if (item && !evidence.includes(item)) {
      evidence.push(item);
    }
  };

  for (const gap of options.validationGaps) {
    add(gap);
  }
  if (options.manifest.preflight?.researchBasisDrift) {
    add("Persisted research evidence no longer matches the current repository signal basis.");
  }
  if ((options.manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0) > 0) {
    add("External research contains unresolved conflicts.");
  }
  if (options.clarifyFollowUp) {
    add(`Missing result contract: ${options.clarifyFollowUp.missingResultContract}`);
    add(`Missing judging basis: ${options.clarifyFollowUp.missingJudgingBasis}`);
  }
  if (
    options.secondOpinionWinnerSelection &&
    options.secondOpinionWinnerSelection.agreement !== "agrees-select" &&
    options.secondOpinionWinnerSelection.agreement !== "agrees-abstain"
  ) {
    add(options.secondOpinionWinnerSelection.advisorySummary);
  }
  if (options.status.outcomeType === "no-survivors") {
    add("No finalists survived the oracle rounds.");
  }
  if (
    options.status.outcomeType === "completed-with-validation-gaps" &&
    options.validationGaps.length === 0
  ) {
    add("Execution completed with unresolved validation gaps.");
  }
  add(options.recommendationAbsenceReason);

  return evidence;
}
