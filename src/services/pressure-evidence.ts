import { mkdir } from "node:fs/promises";

import {
  normalizeConsultationScopePath,
  resolveConsultationArtifacts,
} from "./consultation-artifacts.js";
import { buildVerdictReview, listRecentConsultations } from "./consultations.js";

export { renderPressureEvidenceSummary } from "./pressure-evidence/render.js";

import {
  buildClarifyPressure,
  buildFinalistSelectionPressure,
} from "./pressure-evidence/pressure.js";

export { pressureEvidenceReportSchema } from "./pressure-evidence/schema.js";

import {
  type PressureArtifactCoverage,
  type PressureEvidenceCase,
  type PressureEvidenceReport,
  pressureArtifactCoverageSchema,
  pressureEvidenceCaseSchema,
  pressureEvidenceReportSchema,
} from "./pressure-evidence/schema.js";
import { writeJsonFile } from "./project.js";
import { RunStore } from "./run-store.js";

export type { PressureEvidenceReport } from "./pressure-evidence/schema.js";

export async function collectPressureEvidence(cwd: string): Promise<PressureEvidenceReport> {
  const store = new RunStore(cwd);
  const projectRoot = store.projectRoot;
  const manifests = await listRecentConsultations(projectRoot, Number.MAX_SAFE_INTEGER);
  const clarifyCases: PressureEvidenceCase[] = [];
  const finalistSelectionCases: PressureEvidenceCase[] = [];
  const artifactCoverage = createArtifactCoverageAccumulator();

  for (const manifest of manifests) {
    const normalizedTargetArtifactPath = manifest.taskPacket.targetArtifactPath
      ? normalizeConsultationScopePath(projectRoot, manifest.taskPacket.targetArtifactPath)
      : undefined;
    const normalizedTaskSourcePath = normalizeConsultationScopePath(
      projectRoot,
      manifest.taskPacket.originPath ?? manifest.taskPacket.sourcePath,
    );
    const artifacts = await resolveConsultationArtifacts(projectRoot, manifest.id);
    const preflightReadiness = artifacts.preflightReadiness;
    const clarifyFollowUp = artifacts.clarifyFollowUp;
    const researchBrief = artifacts.researchBrief;
    const comparisonReport = artifacts.comparisonReport;
    const winnerSelection = artifacts.winnerSelection;
    const failureAnalysis = artifacts.failureAnalysis;
    if (preflightReadiness) {
      artifactCoverage.consultationsWithPreflightReadiness += 1;
    }
    if (preflightReadiness?.llmSkipped || preflightReadiness?.llmFailure) {
      artifactCoverage.consultationsWithPreflightFallback += 1;
    }
    if (clarifyFollowUp) {
      artifactCoverage.consultationsWithClarifyFollowUp += 1;
    }
    if (artifacts.comparisonReportAvailable) {
      artifactCoverage.consultationsWithComparisonReport += 1;
    }
    if (winnerSelection) {
      artifactCoverage.consultationsWithWinnerSelection += 1;
    }
    if (failureAnalysis) {
      artifactCoverage.consultationsWithFailureAnalysis += 1;
    }
    if (researchBrief) {
      artifactCoverage.consultationsWithResearchBrief += 1;
    }

    const review = await buildVerdictReview(manifest, artifacts);
    if (review.manualReviewRecommended) {
      artifactCoverage.consultationsWithManualReviewRecommendation += 1;
    }
    const preflightReadinessPath = preflightReadiness
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.preflightReadinessPath)
      : undefined;
    const clarifyFollowUpPath = clarifyFollowUp
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.clarifyFollowUpPath)
      : undefined;
    const researchBriefPath = researchBrief
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.researchBriefPath)
      : undefined;
    const failureAnalysisPath = failureAnalysis
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.failureAnalysisPath)
      : undefined;
    const winnerSelectionPath = winnerSelection
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.winnerSelectionPath)
      : undefined;
    const secondOpinionWinnerSelectionPath = artifacts.secondOpinionWinnerSelection
      ? normalizeOptionalConsultationScopePath(
          projectRoot,
          artifacts.secondOpinionWinnerSelectionPath,
        )
      : undefined;
    const comparisonJsonPath = comparisonReport
      ? normalizeOptionalConsultationScopePath(projectRoot, artifacts.comparisonJsonPath)
      : undefined;
    const comparisonMarkdownPath = normalizeOptionalConsultationScopePath(
      projectRoot,
      artifacts.comparisonMarkdownPath,
    );

    const common = {
      runId: manifest.id,
      consultationPath: normalizeConsultationScopePath(
        projectRoot,
        store.getRunPaths(manifest.id).runDir,
      ),
      openedAt: manifest.createdAt,
      agent: manifest.agent,
      taskTitle: manifest.taskPacket.title,
      taskSourceKind: manifest.taskPacket.sourceKind,
      taskSourcePath: normalizedTaskSourcePath,
      outcomeType: review.outcomeType,
      outcomeSummary: review.outcomeSummary,
      validationPosture: review.validationPosture,
      researchBasisStatus: review.researchBasisStatus,
      ...(review.researchConflictHandling
        ? { researchConflictHandling: review.researchConflictHandling }
        : {}),
      researchRerunRecommended: review.researchRerunRecommended,
      manualReviewRecommended: review.manualReviewRecommended,
      preflightFallbackObserved: Boolean(
        preflightReadiness?.llmSkipped || preflightReadiness?.llmFailure,
      ),
      supportingEvidence: limitEvidence(review.strongestEvidence),
      blockingEvidence: limitEvidence(review.weakestEvidence),
      artifactPaths: {
        ...(preflightReadinessPath ? { preflightReadinessPath } : {}),
        ...(clarifyFollowUpPath ? { clarifyFollowUpPath } : {}),
        ...(researchBriefPath ? { researchBriefPath } : {}),
        ...(failureAnalysisPath ? { failureAnalysisPath } : {}),
        ...(winnerSelectionPath ? { winnerSelectionPath } : {}),
        ...(secondOpinionWinnerSelectionPath ? { secondOpinionWinnerSelectionPath } : {}),
        ...(comparisonJsonPath ? { comparisonJsonPath } : {}),
        ...(comparisonMarkdownPath ? { comparisonMarkdownPath } : {}),
      },
      ...(normalizedTargetArtifactPath ? { targetArtifactPath: normalizedTargetArtifactPath } : {}),
    } as const;

    if (review.outcomeType === "needs-clarification") {
      clarifyCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "clarify-needed",
          summary:
            review.recommendationAbsenceReason ??
            "Execution stopped because operator clarification is still required.",
          ...(review.clarificationQuestion ? { question: review.clarificationQuestion } : {}),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (review.outcomeType === "external-research-required") {
      clarifyCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "external-research-required",
          summary:
            review.recommendationAbsenceReason ??
            "Execution stopped because bounded external research is still required.",
          ...(review.researchQuestion ? { question: review.researchQuestion } : {}),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (review.outcomeType === "finalists-without-recommendation") {
      finalistSelectionCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "finalists-without-recommendation",
          summary:
            review.recommendationAbsenceReason ??
            failureAnalysis?.summary ??
            "Finalists survived without a recorded recommendation.",
          candidateIds: review.finalistIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(manifest, review.finalistIds),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    if (winnerSelection?.recommendation?.decision === "abstain") {
      finalistSelectionCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "judge-abstain",
          summary:
            winnerSelection.recommendation.summary ??
            failureAnalysis?.summary ??
            "The finalist judge abstained.",
          candidateIds: review.finalistIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(manifest, review.finalistIds),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
          confidence: winnerSelection.recommendation.confidence,
        }),
      );
    }

    if (review.manualCrowningCandidateIds.length > 0) {
      finalistSelectionCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "manual-crowning-handoff",
          summary:
            review.manualCrowningReason ??
            "Manual crowning requires operator judgment for the surviving finalists.",
          candidateIds: review.manualCrowningCandidateIds,
          candidateStrategyLabels: resolveCandidateStrategyLabels(
            manifest,
            review.manualCrowningCandidateIds,
          ),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
        }),
      );
    }

    const recommendationConfidence =
      winnerSelection?.recommendation?.decision === "select"
        ? winnerSelection.recommendation.confidence
        : manifest.recommendedWinner?.confidence;
    if (review.outcomeType === "recommended-survivor" && recommendationConfidence === "low") {
      finalistSelectionCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "low-confidence-recommendation",
          summary:
            review.recommendationSummary ??
            manifest.recommendedWinner?.summary ??
            "A recommended result was selected with low confidence.",
          candidateIds: review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          candidateStrategyLabels: resolveCandidateStrategyLabels(
            manifest,
            review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          ),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
          confidence: recommendationConfidence,
        }),
      );
    }

    if (
      review.outcomeType === "recommended-survivor" &&
      artifacts.secondOpinionWinnerSelection &&
      artifacts.secondOpinionWinnerSelection.agreement !== "agrees-select"
    ) {
      finalistSelectionCases.push(
        pressureEvidenceCaseSchema.parse({
          ...common,
          kind: "second-opinion-disagreement",
          summary:
            review.secondOpinionSummary ??
            "The advisory second-opinion judge disagreed with the recommended result.",
          candidateIds: review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          candidateStrategyLabels: resolveCandidateStrategyLabels(
            manifest,
            review.recommendedCandidateId ? [review.recommendedCandidateId] : [],
          ),
          ...(review.judgingCriteria?.length ? { judgingCriteria: review.judgingCriteria } : {}),
          confidence: recommendationConfidence,
        }),
      );
    }
  }

  return pressureEvidenceReportSchema.parse({
    generatedAt: new Date().toISOString(),
    projectRoot,
    consultationCount: manifests.length,
    artifactCoverage: pressureArtifactCoverageSchema.parse(artifactCoverage),
    clarifyPressure: buildClarifyPressure(projectRoot, clarifyCases),
    finalistSelectionPressure: buildFinalistSelectionPressure(projectRoot, finalistSelectionCases),
  });
}

export async function writePressureEvidenceReport(cwd: string): Promise<{
  path: string;
  projectRoot: string;
  report: PressureEvidenceReport;
}> {
  const report = await collectPressureEvidence(cwd);
  const store = new RunStore(report.projectRoot);
  const path = store.pressureEvidencePath;
  await mkdir(store.oraculumDir, { recursive: true });
  await writeJsonFile(path, report);
  return {
    path,
    projectRoot: report.projectRoot,
    report,
  };
}

function createArtifactCoverageAccumulator(): PressureArtifactCoverage {
  return {
    consultationsWithPreflightReadiness: 0,
    consultationsWithPreflightFallback: 0,
    consultationsWithClarifyFollowUp: 0,
    consultationsWithComparisonReport: 0,
    consultationsWithWinnerSelection: 0,
    consultationsWithFailureAnalysis: 0,
    consultationsWithResearchBrief: 0,
    consultationsWithManualReviewRecommendation: 0,
  };
}

function limitEvidence(evidence: string[]): string[] {
  return evidence.slice(0, 3);
}

function normalizeOptionalConsultationScopePath(
  projectRoot: string,
  path: string | undefined,
): string | undefined {
  return path ? normalizeConsultationScopePath(projectRoot, path) : undefined;
}

function resolveCandidateStrategyLabels(
  manifest: Awaited<ReturnType<typeof listRecentConsultations>>[number],
  candidateIds: string[],
): string[] {
  if (candidateIds.length === 0) {
    return [];
  }

  const labels = candidateIds
    .map(
      (candidateId) =>
        manifest.candidates.find((candidate) => candidate.id === candidateId)?.strategyLabel,
    )
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
}
