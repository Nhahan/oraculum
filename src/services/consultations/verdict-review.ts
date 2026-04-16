import type { z } from "zod";

import type { agentJudgeResultSchema } from "../../adapters/types.js";
import type { VerdictReview } from "../../domain/chat-native.js";
import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../domain/profile.js";
import type { consultationClarifyFollowUpSchema } from "../../domain/run.js";
import {
  buildSavedConsultationStatus,
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  type RunManifest,
} from "../../domain/run.js";
import { deriveResearchBasisStatus, deriveResearchConflictHandling } from "../../domain/task.js";

import {
  filterArtifactForConsultationRun,
  hasCurrentComparisonMarkdownArtifact,
  readClarifyFollowUpArtifact,
  readComparisonReportArtifact,
  readExportPlanArtifact,
  readFailureAnalysisArtifact,
  readPreflightReadinessArtifact,
  readProfileSelectionArtifact,
  readResearchBriefArtifact,
  readSecondOpinionWinnerSelectionArtifact,
  readWinnerSelectionArtifact,
} from "../consultation-artifacts.js";
import type { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";
import type { comparisonReportSchema } from "../finalist-report.js";

export async function buildVerdictReview(
  manifest: RunManifest,
  artifacts: {
    consultationRoot?: string;
    configPath?: string;
    preflightReadinessPath?: string;
    clarifyFollowUpPath?: string;
    researchBriefPath?: string;
    failureAnalysisPath?: string;
    profileSelectionPath?: string;
    comparisonJsonPath?: string;
    comparisonMarkdownPath?: string;
    winnerSelectionPath?: string;
    secondOpinionWinnerSelectionPath?: string;
    crowningRecordPath?: string;
  },
): Promise<VerdictReview> {
  const hasExportedCandidate = manifest.candidates.some(
    (candidate) => candidate.status === "exported",
  );
  const comparisonReport = await readComparisonReportArtifact(artifacts.comparisonJsonPath);
  const comparisonMarkdownAvailable = artifacts.comparisonMarkdownPath
    ? await hasCurrentComparisonMarkdownArtifact(artifacts.comparisonMarkdownPath, manifest.id)
    : false;
  const preflightReadiness = filterArtifactForConsultationRun(
    await readPreflightReadinessArtifact(artifacts.preflightReadinessPath),
    { expectedRunId: manifest.id },
  );
  const winnerSelection = filterArtifactForConsultationRun(
    await readWinnerSelectionArtifact(artifacts.winnerSelectionPath),
    { expectedRunId: manifest.id },
  );
  const clarifyFollowUp = filterArtifactForConsultationRun(
    await readClarifyFollowUpArtifact(artifacts.clarifyFollowUpPath),
    { expectedRunId: manifest.id },
  );
  const researchBrief = filterArtifactForConsultationRun(
    await readResearchBriefArtifact(artifacts.researchBriefPath),
    { expectedRunId: manifest.id },
  );
  const failureAnalysis = filterArtifactForConsultationRun(
    await readFailureAnalysisArtifact(artifacts.failureAnalysisPath),
    { expectedRunId: manifest.id },
  );
  const profileSelectionArtifact = filterArtifactForConsultationRun(
    await readProfileSelectionArtifact(artifacts.profileSelectionPath),
    { expectedRunId: manifest.id },
  );
  const exportPlan = filterArtifactForConsultationRun(
    await readExportPlanArtifact(artifacts.crowningRecordPath),
    { expectedRunId: manifest.id },
  );
  const secondOpinionWinnerSelection = filterArtifactForConsultationRun(
    await readSecondOpinionWinnerSelectionArtifact(artifacts.secondOpinionWinnerSelectionPath),
    { expectedRunId: manifest.id },
  );
  const filteredComparisonReport = filterArtifactForConsultationRun(comparisonReport, {
    expectedRunId: manifest.id,
  });
  const status = buildSavedConsultationStatus(manifest, {
    comparisonReportAvailable: Boolean(filteredComparisonReport || comparisonMarkdownAvailable),
    crowningRecordAvailable: Boolean(hasExportedCandidate && exportPlan),
    ...(secondOpinionWinnerSelection && secondOpinionWinnerSelection.agreement !== "agrees-select"
      ? { manualReviewRequired: true }
      : {}),
  });
  const researchRerunInputPath =
    manifest.taskPacket.sourceKind === "research-brief"
      ? manifest.taskPacket.sourcePath
      : researchBrief
        ? artifacts.researchBriefPath
        : undefined;
  const researchRerunRecommended =
    status.outcomeType === "external-research-required" || status.researchBasisDrift === true;
  const candidateStateCounts = manifest.candidates.reduce<Record<string, number>>(
    (counts, candidate) => {
      counts[candidate.status] = (counts[candidate.status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const finalistIds = manifest.candidates
    .filter((candidate) => candidate.status === "promoted" || candidate.status === "exported")
    .map((candidate) => candidate.id);
  const reviewFinalistIds =
    finalistIds.length === 0 &&
    status.outcomeType === "recommended-survivor" &&
    status.recommendedCandidateId
      ? [status.recommendedCandidateId]
      : finalistIds;
  const validationSummary = getValidationSummary(manifest.profileSelection);
  const validationSignals = getValidationSignals(manifest.profileSelection);
  const validationGaps = getValidationGaps(manifest.profileSelection);
  const strongestEvidence = buildReviewStrongestEvidence({
    clarifyFollowUp,
    comparisonReport: filteredComparisonReport,
    manifest,
    reviewFinalistIds,
    secondOpinionWinnerSelection,
    status,
    validationSignals,
    validationSummary,
  });
  const recommendationSummary =
    status.outcomeType === "recommended-survivor"
      ? (filteredComparisonReport?.whyThisWon ?? manifest.recommendedWinner?.summary)
      : undefined;
  const judgingCriteria = winnerSelection?.recommendation?.judgingCriteria;
  const recommendationAbsenceReason = buildRecommendationAbsenceReason({
    status,
    validationGaps,
    winnerSelection,
  });
  const weakestEvidence = buildReviewWeakestEvidence({
    clarifyFollowUp,
    manifest,
    recommendationAbsenceReason,
    secondOpinionWinnerSelection,
    status,
    validationGaps,
  });
  const manualCrowningCandidateIds =
    status.outcomeType === "finalists-without-recommendation" ? reviewFinalistIds : [];
  const manualReviewRecommended =
    status.outcomeType === "finalists-without-recommendation" ||
    status.outcomeType === "completed-with-validation-gaps" ||
    status.outcomeType === "needs-clarification" ||
    status.outcomeType === "external-research-required" ||
    (status.outcomeType === "recommended-survivor" &&
      Boolean(
        secondOpinionWinnerSelection && secondOpinionWinnerSelection.agreement !== "agrees-select",
      ));
  const manualCrowningReason =
    manualCrowningCandidateIds.length > 0
      ? "Finalists survived without a recorded recommendation; manual crowning requires operator judgment."
      : undefined;

  return {
    outcomeType: status.outcomeType,
    outcomeSummary: describeConsultationOutcomeSummary({
      outcomeType: status.outcomeType,
      ...(manifest.taskPacket.artifactKind
        ? { taskArtifactKind: manifest.taskPacket.artifactKind }
        : {}),
      ...(manifest.taskPacket.targetArtifactPath
        ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
        : {}),
    }),
    verificationLevel: status.verificationLevel,
    validationPosture: status.validationPosture,
    judgingBasisKind: status.judgingBasisKind,
    judgingBasisSummary: describeConsultationJudgingBasisSummary(status.judgingBasisKind),
    taskSourceKind: manifest.taskPacket.sourceKind,
    taskSourcePath: manifest.taskPacket.sourcePath,
    ...(manifest.taskPacket.artifactKind
      ? { taskArtifactKind: manifest.taskPacket.artifactKind }
      : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: manifest.taskPacket.targetArtifactPath }
      : {}),
    ...(manifest.taskPacket.researchContext?.summary
      ? { researchSummary: manifest.taskPacket.researchContext.summary }
      : {}),
    ...(manifest.taskPacket.researchContext?.confidence
      ? { researchConfidence: manifest.taskPacket.researchContext.confidence }
      : {}),
    researchBasisStatus: deriveResearchBasisStatus({
      researchContext: manifest.taskPacket.researchContext,
      researchBasisDrift: manifest.preflight?.researchBasisDrift,
    }),
    ...(manifest.taskPacket.researchContext
      ? {
          researchConflictHandling:
            manifest.taskPacket.researchContext.conflictHandling ??
            deriveResearchConflictHandling(manifest.taskPacket.researchContext.unresolvedConflicts),
        }
      : {}),
    researchSignalCount: manifest.taskPacket.researchContext?.signalSummary.length ?? 0,
    ...(manifest.taskPacket.researchContext?.signalFingerprint
      ? { researchSignalFingerprint: manifest.taskPacket.researchContext.signalFingerprint }
      : {}),
    ...(manifest.preflight?.researchBasisDrift !== undefined
      ? { researchBasisDrift: manifest.preflight.researchBasisDrift }
      : {}),
    researchRerunRecommended,
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    researchSourceCount: manifest.taskPacket.researchContext?.sources.length ?? 0,
    researchClaimCount: manifest.taskPacket.researchContext?.claims.length ?? 0,
    researchVersionNoteCount: manifest.taskPacket.researchContext?.versionNotes.length ?? 0,
    researchConflictCount: manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0,
    researchConflictsPresent:
      (manifest.taskPacket.researchContext?.unresolvedConflicts.length ?? 0) > 0,
    ...(manifest.taskPacket.originKind && manifest.taskPacket.originPath
      ? {
          taskOriginSourceKind: manifest.taskPacket.originKind,
          taskOriginSourcePath: manifest.taskPacket.originPath,
        }
      : {}),
    ...(status.recommendedCandidateId
      ? { recommendedCandidateId: status.recommendedCandidateId }
      : {}),
    finalistIds: reviewFinalistIds,
    strongestEvidence,
    weakestEvidence,
    secondOpinionTriggerKinds: secondOpinionWinnerSelection?.triggerKinds ?? [],
    secondOpinionTriggerReasons: secondOpinionWinnerSelection?.triggerReasons ?? [],
    ...(judgingCriteria?.length ? { judgingCriteria } : {}),
    ...(recommendationSummary ? { recommendationSummary } : {}),
    ...(recommendationAbsenceReason ? { recommendationAbsenceReason } : {}),
    ...(secondOpinionWinnerSelection
      ? {
          secondOpinionAdapter: secondOpinionWinnerSelection.adapter,
          secondOpinionAgreement: secondOpinionWinnerSelection.agreement,
          secondOpinionSummary: secondOpinionWinnerSelection.advisorySummary,
        }
      : {}),
    ...(secondOpinionWinnerSelection?.result?.recommendation?.decision
      ? { secondOpinionDecision: secondOpinionWinnerSelection.result.recommendation.decision }
      : {}),
    ...(secondOpinionWinnerSelection?.result?.recommendation?.candidateId
      ? { secondOpinionCandidateId: secondOpinionWinnerSelection.result.recommendation.candidateId }
      : {}),
    ...(secondOpinionWinnerSelection?.result?.recommendation?.confidence
      ? { secondOpinionConfidence: secondOpinionWinnerSelection.result.recommendation.confidence }
      : {}),
    manualReviewRecommended,
    manualCrowningCandidateIds,
    ...(manualCrowningReason ? { manualCrowningReason } : {}),
    ...(getValidationProfileId(manifest.profileSelection)
      ? { validationProfileId: getValidationProfileId(manifest.profileSelection) }
      : {}),
    ...(validationSummary ? { validationSummary } : {}),
    validationSignals,
    validationGaps,
    ...(manifest.preflight?.decision ? { preflightDecision: manifest.preflight.decision } : {}),
    researchPosture: status.researchPosture,
    ...(manifest.preflight?.clarificationQuestion
      ? { clarificationQuestion: manifest.preflight.clarificationQuestion }
      : {}),
    ...(manifest.preflight?.researchQuestion
      ? { researchQuestion: manifest.preflight.researchQuestion }
      : {}),
    ...(clarifyFollowUp ? { clarifyScopeKeyType: clarifyFollowUp.scopeKeyType } : {}),
    ...(clarifyFollowUp ? { clarifyScopeKey: clarifyFollowUp.scopeKey } : {}),
    ...(clarifyFollowUp ? { clarifyRepeatedCaseCount: clarifyFollowUp.repeatedCaseCount } : {}),
    ...(clarifyFollowUp ? { clarifyFollowUpQuestion: clarifyFollowUp.keyQuestion } : {}),
    ...(clarifyFollowUp
      ? { clarifyMissingResultContract: clarifyFollowUp.missingResultContract }
      : {}),
    ...(clarifyFollowUp ? { clarifyMissingJudgingBasis: clarifyFollowUp.missingJudgingBasis } : {}),
    artifactAvailability: {
      preflightReadiness: Boolean(preflightReadiness),
      clarifyFollowUp: Boolean(clarifyFollowUp),
      researchBrief: Boolean(researchBrief),
      failureAnalysis: Boolean(failureAnalysis),
      profileSelection: Boolean(profileSelectionArtifact),
      comparisonReport: Boolean(filteredComparisonReport || comparisonMarkdownAvailable),
      winnerSelection: Boolean(winnerSelection),
      secondOpinionWinnerSelection: Boolean(secondOpinionWinnerSelection),
      crowningRecord: hasExportedCandidate && Boolean(exportPlan),
    },
    candidateStateCounts,
  };
}

function buildReviewStrongestEvidence(options: {
  clarifyFollowUp: z.infer<typeof consultationClarifyFollowUpSchema> | undefined;
  comparisonReport: z.infer<typeof comparisonReportSchema> | undefined;
  manifest: RunManifest;
  reviewFinalistIds: string[];
  secondOpinionWinnerSelection:
    | z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>
    | undefined;
  status: ReturnType<typeof buildSavedConsultationStatus>;
  validationSignals: string[];
  validationSummary: string | undefined;
}): string[] {
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

function buildReviewWeakestEvidence(options: {
  clarifyFollowUp: z.infer<typeof consultationClarifyFollowUpSchema> | undefined;
  manifest: RunManifest;
  recommendationAbsenceReason: string | undefined;
  secondOpinionWinnerSelection:
    | z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>
    | undefined;
  status: ReturnType<typeof buildSavedConsultationStatus>;
  validationGaps: string[];
}): string[] {
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

function buildRecommendationAbsenceReason(options: {
  status: ReturnType<typeof buildSavedConsultationStatus>;
  validationGaps: string[];
  winnerSelection: z.infer<typeof agentJudgeResultSchema> | undefined;
}): string | undefined {
  switch (options.status.outcomeType) {
    case "recommended-survivor":
      return undefined;
    case "finalists-without-recommendation":
      if (options.winnerSelection?.recommendation?.decision === "abstain") {
        return options.winnerSelection.recommendation.summary;
      }
      return "Finalists survived, but no recommendation was recorded.";
    case "completed-with-validation-gaps":
      return options.validationGaps.length > 0
        ? `Validation gaps remain: ${options.validationGaps.join("; ")}.`
        : "Execution completed with unresolved validation gaps.";
    case "no-survivors":
      return "No finalists survived the oracle rounds.";
    case "needs-clarification":
      return "Execution stopped because operator clarification is still required.";
    case "external-research-required":
      return "Execution stopped because bounded external research is still required.";
    case "abstained-before-execution":
      return "Execution was declined before candidate generation.";
    case "pending-execution":
      return "Candidate execution has not started yet.";
    case "running":
      return "Candidate execution is still in progress.";
  }
}
