import type { PressureEvidenceCase, PressureLaneArtifactCoverage } from "../schema.js";
import { buildExpectedClarifyFollowUpRunIds } from "../shared.js";

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
