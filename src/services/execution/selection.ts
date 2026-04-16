import type { Adapter } from "../../domain/config.js";
import { getValidationGaps, getValidationProfileId } from "../../domain/profile.js";
import type {
  CandidateManifest,
  CandidateScorecard,
  RunManifest,
  RunRecommendation,
} from "../../domain/run.js";
import type { CandidateSelectionMetrics } from "./shared.js";

export function resolveSecondOpinionAdapterName(
  primaryAdapter: Adapter,
  enabledAdapters: Adapter[],
  configuredAdapter: Adapter | undefined,
): Adapter {
  if (configuredAdapter && enabledAdapters.includes(configuredAdapter)) {
    return configuredAdapter;
  }

  const alternateAdapter = primaryAdapter === "claude-code" ? "codex" : "claude-code";
  return enabledAdapters.includes(alternateAdapter) ? alternateAdapter : primaryAdapter;
}

export function chooseFallbackWinner(
  candidates: CandidateManifest[],
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  consultationProfile?: RunManifest["profileSelection"],
  scorecardsByCandidate?: Map<string, CandidateScorecard>,
): RunRecommendation | undefined {
  const finalists = candidates.filter((candidate) => candidate.status === "promoted");
  if (finalists.length === 0) {
    return undefined;
  }

  const ranked = rankFallbackCandidates(finalists, metricsByCandidate, scorecardsByCandidate);

  const winner = ranked[0];
  if (!winner) {
    return undefined;
  }

  const winnerMetrics = metricsByCandidate.get(winner.id);
  const validationGaps = getValidationGaps(consultationProfile);
  const validationProfileId = getValidationProfileId(consultationProfile);
  const hasProfileGaps = validationGaps.length > 0;
  if (finalists.length === 1) {
    const confidence = hasProfileGaps ? "medium" : "high";
    return {
      candidateId: winner.id,
      confidence,
      summary: hasProfileGaps
        ? `Selected by fallback policy because ${winner.id} is the only surviving finalist, but the selected validation posture${validationProfileId ? ` (${validationProfileId})` : ""} still has validation gaps: ${validationGaps.join("; ")}.`
        : `Selected by fallback policy because ${winner.id} is the only surviving finalist.`,
      source: "fallback-policy",
    };
  }

  const runnerUp = ranked[1];
  const runnerUpMetrics = runnerUp ? metricsByCandidate.get(runnerUp.id) : undefined;
  const winnerPenalty = buildPenalty(winnerMetrics);
  const runnerUpPenalty = buildPenalty(runnerUpMetrics);
  const winnerPassCount = winnerMetrics?.passCount ?? 0;
  const runnerUpPassCount = runnerUpMetrics?.passCount ?? 0;
  let confidence: RunRecommendation["confidence"] =
    winnerPenalty < runnerUpPenalty || winnerPassCount > runnerUpPassCount ? "medium" : "low";
  if (hasProfileGaps) {
    confidence = "low";
  }

  return {
    candidateId: winner.id,
    confidence,
    summary:
      confidence === "medium"
        ? `Selected by fallback policy from ${finalists.length} finalists using current deterministic signals: fewer warnings/errors, stronger pass coverage, and better artifact coverage.`
        : hasProfileGaps
          ? `Selected by fallback policy from ${finalists.length} finalists, but the selected validation posture${validationProfileId ? ` (${validationProfileId})` : ""} still has validation gaps: ${validationGaps.join("; ")}.`
          : `Selected by fallback policy from ${finalists.length} finalists; finalists were close, so confidence is limited.`,
    source: "fallback-policy",
  };
}

export function rankFallbackCandidates(
  finalists: CandidateManifest[],
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  scorecardsByCandidate?: Map<string, CandidateScorecard>,
): CandidateManifest[] {
  return [...finalists].sort((left, right) => {
    const leftMetrics = metricsByCandidate.get(left.id);
    const rightMetrics = metricsByCandidate.get(right.id);

    const scorecardComparison = compareFallbackScorecards(
      scorecardsByCandidate?.get(left.id),
      scorecardsByCandidate?.get(right.id),
    );
    if (scorecardComparison !== 0) {
      return scorecardComparison;
    }

    const leftPenalty = buildPenalty(leftMetrics);
    const rightPenalty = buildPenalty(rightMetrics);
    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }

    const leftPassCount = leftMetrics?.passCount ?? 0;
    const rightPassCount = rightMetrics?.passCount ?? 0;
    if (leftPassCount !== rightPassCount) {
      return rightPassCount - leftPassCount;
    }

    const leftArtifactCount = leftMetrics?.artifactCount ?? 0;
    const rightArtifactCount = rightMetrics?.artifactCount ?? 0;
    if (leftArtifactCount !== rightArtifactCount) {
      return rightArtifactCount - leftArtifactCount;
    }

    return left.id.localeCompare(right.id);
  });
}

function compareFallbackScorecards(
  left: CandidateScorecard | undefined,
  right: CandidateScorecard | undefined,
): number {
  if (!left && !right) {
    return 0;
  }
  if (left && !right) {
    return -1;
  }
  if (!left && right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const leftPenalty = buildScorecardPenalty(left);
  const rightPenalty = buildScorecardPenalty(right);
  if (leftPenalty !== rightPenalty) {
    return leftPenalty - rightPenalty;
  }

  const leftCoverage = countCoveredWorkstreams(left);
  const rightCoverage = countCoveredWorkstreams(right);
  if (leftCoverage !== rightCoverage) {
    return rightCoverage - leftCoverage;
  }

  const leftPassStages = countPassingStages(left);
  const rightPassStages = countPassingStages(right);
  if (leftPassStages !== rightPassStages) {
    return rightPassStages - leftPassStages;
  }

  const leftRiskCount = left.unresolvedRisks.length;
  const rightRiskCount = right.unresolvedRisks.length;
  if (leftRiskCount !== rightRiskCount) {
    return leftRiskCount - rightRiskCount;
  }

  if (left.artifactCoherence !== right.artifactCoherence) {
    return (
      rankArtifactCoherence(right.artifactCoherence) - rankArtifactCoherence(left.artifactCoherence)
    );
  }

  return 0;
}

function buildScorecardPenalty(scorecard: CandidateScorecard): number {
  return (
    countNonPassingStages(scorecard) * 1_000 +
    scorecard.violations.length * 100 +
    scorecard.unresolvedRisks.length * 10
  );
}

function countCoveredWorkstreams(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.reduce(
    (total, stageResult) =>
      total +
      Object.values(stageResult.workstreamCoverage).filter((status) => status === "covered").length,
    0,
  );
}

function countPassingStages(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.filter((stageResult) => stageResult.status === "pass").length;
}

function countNonPassingStages(scorecard: CandidateScorecard): number {
  return scorecard.stageResults.filter((stageResult) => stageResult.status !== "pass").length;
}

function rankArtifactCoherence(coherence: CandidateScorecard["artifactCoherence"]): number {
  switch (coherence) {
    case "strong":
      return 3;
    case "weak":
      return 2;
    case "unknown":
      return 1;
  }
}

function buildPenalty(metrics: CandidateSelectionMetrics | undefined): number {
  if (!metrics) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    metrics.criticalCount * 1000 +
    metrics.errorCount * 100 +
    metrics.warningCount * 10 +
    metrics.repairableCount
  );
}
