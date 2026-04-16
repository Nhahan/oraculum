import { RunStore } from "../run-store.js";
import {
  type PressureCoverageGapRun,
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureLaneArtifactCoverage,
  type PressureMetadataCoverage,
  type PressureMissingArtifactKind,
  pressureCoverageGapRunSchema,
  pressureLaneArtifactCoverageSchema,
  pressureMetadataCoverageSchema,
  pressureMissingArtifactBreakdownSchema,
} from "./schema.js";
import { buildExpectedClarifyFollowUpRunIds } from "./shared.js";

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

export function buildClarifyCoverageBlindSpots(
  cases: PressureEvidenceCase[],
  artifactCoverage: PressureLaneArtifactCoverage,
): string[] {
  const blindSpots: string[] = [];
  const expectedClarifyFollowUpRunIds = buildExpectedClarifyFollowUpRunIds(cases);

  if (
    artifactCoverage.caseCount > 0 &&
    artifactCoverage.casesWithPreflightReadiness < cases.length
  ) {
    blindSpots.push("Some clarify cases are missing preflight-readiness artifacts.");
  }
  const structuredPreflightCases =
    artifactCoverage.casesWithPreflightReadiness - artifactCoverage.casesWithPreflightFallback;
  if (
    artifactCoverage.caseCount > 0 &&
    artifactCoverage.casesWithPreflightFallback > structuredPreflightCases
  ) {
    blindSpots.push(
      "Clarify evidence is dominated by fallback preflight results instead of structured runtime recommendations.",
    );
  }
  if (
    cases.some((item) => item.kind === "external-research-required") &&
    cases.some(
      (item) => item.kind === "external-research-required" && !item.artifactPaths.researchBriefPath,
    )
  ) {
    blindSpots.push("External-research blockers have no persisted research-brief artifacts yet.");
  }
  if (
    expectedClarifyFollowUpRunIds.size > 0 &&
    cases.some(
      (item) =>
        expectedClarifyFollowUpRunIds.has(item.runId) && !item.artifactPaths.clarifyFollowUpPath,
    )
  ) {
    blindSpots.push("Repeated clarify pressure is missing persisted clarify-follow-up artifacts.");
  }

  return blindSpots;
}

export function buildFinalistCoverageBlindSpots(cases: PressureEvidenceCase[]): string[] {
  const blindSpots: string[] = [];

  if (
    cases.some(
      (item) =>
        item.kind === "finalists-without-recommendation" ||
        item.kind === "judge-abstain" ||
        item.kind === "low-confidence-recommendation" ||
        item.kind === "second-opinion-disagreement",
    ) &&
    cases.some(
      (item) =>
        (item.kind === "finalists-without-recommendation" ||
          item.kind === "judge-abstain" ||
          item.kind === "low-confidence-recommendation" ||
          item.kind === "second-opinion-disagreement") &&
        !item.artifactPaths.winnerSelectionPath,
    )
  ) {
    blindSpots.push(
      "Some finalist-selection pressure cases are missing winner-selection artifacts.",
    );
  }
  if (
    cases.some((item) => item.kind === "judge-abstain") &&
    cases.some((item) => item.kind === "judge-abstain" && !item.artifactPaths.failureAnalysisPath)
  ) {
    blindSpots.push(
      "Judge-abstain cases are present without persisted failure-analysis artifacts.",
    );
  }
  if (
    cases.some(
      (item) =>
        (item.kind === "finalists-without-recommendation" ||
          item.kind === "judge-abstain" ||
          item.kind === "manual-crowning-handoff" ||
          item.kind === "second-opinion-disagreement" ||
          item.kind === "low-confidence-recommendation") &&
        !item.artifactPaths.comparisonJsonPath &&
        !item.artifactPaths.comparisonMarkdownPath,
    )
  ) {
    blindSpots.push("Some finalist-selection pressure cases are missing comparison reports.");
  }
  if (
    cases.some(
      (item) =>
        (item.kind === "low-confidence-recommendation" ||
          item.kind === "second-opinion-disagreement") &&
        !item.artifactPaths.secondOpinionWinnerSelectionPath,
    )
  ) {
    blindSpots.push(
      "Some finalist-selection pressure cases are missing advisory second-opinion artifacts.",
    );
  }
  if (
    cases.some((item) => item.kind === "manual-crowning-handoff") &&
    cases.some((item) => item.kind === "manual-crowning-handoff" && !item.manualReviewRecommended)
  ) {
    blindSpots.push(
      "Manual-crowning handoff cases are present without manual-review recommendations.",
    );
  }

  return blindSpots;
}

export function buildCoverageGapRuns(
  projectRoot: string,
  cases: PressureEvidenceCase[],
  getMissingArtifactKinds: (item: PressureEvidenceCase) => PressureMissingArtifactKind[],
): PressureCoverageGapRun[] {
  const store = new RunStore(projectRoot);
  const grouped = new Map<
    string,
    {
      agent: PressureEvidenceCase["agent"];
      consultationPath: string;
      kinds: Set<PressureEvidenceCaseKind>;
      missingArtifactKinds: Set<PressureMissingArtifactKind>;
      openedAt: string;
      runId: string;
      targetArtifactPath?: string;
      taskSourceKind: PressureEvidenceCase["taskSourceKind"];
      taskSourcePath: string;
      taskTitle: string;
    }
  >();

  for (const item of cases) {
    const missingArtifactKinds = getMissingArtifactKinds(item);
    if (missingArtifactKinds.length === 0) {
      continue;
    }

    const current = grouped.get(item.runId);
    if (!current) {
      grouped.set(item.runId, {
        agent: item.agent,
        consultationPath: item.consultationPath,
        kinds: new Set([item.kind]),
        missingArtifactKinds: new Set(missingArtifactKinds),
        openedAt: item.openedAt,
        runId: item.runId,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        taskTitle: item.taskTitle,
      });
      continue;
    }

    current.kinds.add(item.kind);
    for (const missingArtifactKind of missingArtifactKinds) {
      current.missingArtifactKinds.add(missingArtifactKind);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
    .map((item) =>
      pressureCoverageGapRunSchema.parse({
        runId: item.runId,
        openedAt: item.openedAt,
        agent: item.agent,
        taskTitle: item.taskTitle,
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        consultationPath: item.consultationPath,
        manifestPath: store.getRunPaths(item.runId).manifestPath,
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
        missingArtifactKinds: [...item.missingArtifactKinds].sort((left, right) =>
          left.localeCompare(right),
        ),
      }),
    );
}

export function buildMissingArtifactBreakdown(
  gapRuns: PressureCoverageGapRun[],
): Array<ReturnType<typeof pressureMissingArtifactBreakdownSchema.parse>> {
  const grouped = new Map<PressureMissingArtifactKind, Set<string>>();

  for (const item of gapRuns) {
    for (const missingArtifactKind of item.missingArtifactKinds) {
      const current = grouped.get(missingArtifactKind);
      if (!current) {
        grouped.set(missingArtifactKind, new Set([item.runId]));
        continue;
      }

      current.add(item.runId);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].size !== left[1].size) {
        return right[1].size - left[1].size;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([artifactKind, runIds]) =>
      pressureMissingArtifactBreakdownSchema.parse({
        artifactKind,
        consultationCount: runIds.size,
      }),
    );
}

export function getClarifyMissingArtifacts(
  item: PressureEvidenceCase,
  expectedClarifyFollowUpRunIds = new Set<string>(),
): PressureMissingArtifactKind[] {
  const missingArtifacts: PressureMissingArtifactKind[] = [];

  if (!item.artifactPaths.preflightReadinessPath) {
    missingArtifacts.push("preflight-readiness");
  }
  if (item.kind === "external-research-required" && !item.artifactPaths.researchBriefPath) {
    missingArtifacts.push("research-brief");
  }
  if (expectedClarifyFollowUpRunIds.has(item.runId) && !item.artifactPaths.clarifyFollowUpPath) {
    missingArtifacts.push("clarify-follow-up");
  }

  return missingArtifacts;
}

export function getFinalistMissingArtifacts(
  item: PressureEvidenceCase,
): PressureMissingArtifactKind[] {
  const missingArtifacts: PressureMissingArtifactKind[] = [];
  const hasComparisonReport = Boolean(
    item.artifactPaths.comparisonJsonPath || item.artifactPaths.comparisonMarkdownPath,
  );

  if (
    (item.kind === "finalists-without-recommendation" ||
      item.kind === "judge-abstain" ||
      item.kind === "second-opinion-disagreement" ||
      item.kind === "low-confidence-recommendation") &&
    !item.artifactPaths.winnerSelectionPath
  ) {
    missingArtifacts.push("winner-selection");
  }
  if (
    (item.kind === "finalists-without-recommendation" ||
      item.kind === "judge-abstain" ||
      item.kind === "manual-crowning-handoff" ||
      item.kind === "second-opinion-disagreement" ||
      item.kind === "low-confidence-recommendation") &&
    !hasComparisonReport
  ) {
    missingArtifacts.push("comparison-report");
  }
  if (item.kind === "judge-abstain" && !item.artifactPaths.failureAnalysisPath) {
    missingArtifacts.push("failure-analysis");
  }
  if (
    (item.kind === "low-confidence-recommendation" ||
      item.kind === "second-opinion-disagreement") &&
    !item.artifactPaths.secondOpinionWinnerSelectionPath
  ) {
    missingArtifacts.push("winner-selection-second-opinion");
  }

  return missingArtifacts;
}
