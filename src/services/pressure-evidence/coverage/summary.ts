import type { PressureEvidenceCase, PressureLaneArtifactCoverage, PressureMetadataCoverage } from "../schema.js";
import { pressureLaneArtifactCoverageSchema, pressureMetadataCoverageSchema } from "../schema.js";

export function buildPressureMetadataCoverage(
  cases: PressureEvidenceCase[],
): PressureMetadataCoverage {
  const grouped = new Map<
    string,
    {
      judgingCriteria: boolean;
      researchConflicts: boolean;
      researchCurrent: boolean;
      researchRerunRecommended: boolean;
      researchStale: boolean;
      researchUnknown: boolean;
      validationGaps: boolean;
    }
  >();

  for (const item of cases) {
    const current = grouped.get(item.runId) ?? {
      judgingCriteria: false,
      researchConflicts: false,
      researchCurrent: false,
      researchRerunRecommended: false,
      researchStale: false,
      researchUnknown: false,
      validationGaps: false,
    };
    current.validationGaps ||= item.validationPosture === "validation-gaps";
    current.researchCurrent ||= item.researchBasisStatus === "current";
    current.researchStale ||= item.researchBasisStatus === "stale";
    current.researchUnknown ||= item.researchBasisStatus === "unknown";
    current.researchConflicts ||= item.researchConflictHandling === "manual-review-required";
    current.researchRerunRecommended ||= item.researchRerunRecommended;
    current.judgingCriteria ||= Boolean(item.judgingCriteria?.length);
    grouped.set(item.runId, current);
  }

  const values = [...grouped.values()];
  return pressureMetadataCoverageSchema.parse({
    consultationCount: grouped.size,
    consultationsWithValidationGaps: values.filter((item) => item.validationGaps).length,
    consultationsWithCurrentResearchBasis: values.filter((item) => item.researchCurrent).length,
    consultationsWithStaleResearchBasis: values.filter((item) => item.researchStale).length,
    consultationsWithUnknownResearchBasis: values.filter((item) => item.researchUnknown).length,
    consultationsWithResearchConflicts: values.filter((item) => item.researchConflicts).length,
    consultationsWithResearchRerunRecommended: values.filter(
      (item) => item.researchRerunRecommended,
    ).length,
    consultationsWithJudgingCriteria: values.filter((item) => item.judgingCriteria).length,
  });
}

export function buildPressureArtifactCoverage(
  cases: PressureEvidenceCase[],
): PressureLaneArtifactCoverage {
  return pressureLaneArtifactCoverageSchema.parse({
    caseCount: cases.length,
    casesWithTargetArtifact: cases.filter((item) => item.targetArtifactPath).length,
    casesWithPreflightReadiness: cases.filter((item) => item.artifactPaths.preflightReadinessPath)
      .length,
    casesWithPreflightFallback: cases.filter((item) => item.preflightFallbackObserved).length,
    casesWithClarifyFollowUp: cases.filter((item) => item.artifactPaths.clarifyFollowUpPath).length,
    casesWithComparisonReport: cases.filter(
      (item) => item.artifactPaths.comparisonJsonPath || item.artifactPaths.comparisonMarkdownPath,
    ).length,
    casesWithWinnerSelection: cases.filter((item) => item.artifactPaths.winnerSelectionPath).length,
    casesWithFailureAnalysis: cases.filter((item) => item.artifactPaths.failureAnalysisPath).length,
    casesWithResearchBrief: cases.filter((item) => item.artifactPaths.researchBriefPath).length,
    casesWithManualReviewRecommendation: cases.filter((item) => item.manualReviewRecommended)
      .length,
  });
}
