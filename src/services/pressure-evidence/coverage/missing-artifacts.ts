import type { PressureEvidenceCase, PressureMissingArtifactKind } from "../schema.js";

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
