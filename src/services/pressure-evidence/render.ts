import type {
  PressureAgentBreakdown,
  PressureEvidenceCase,
  PressureEvidenceReport,
  PressureInspectionItem,
  PressureMissingArtifactBreakdown,
} from "./schema.js";

export function renderPressureEvidenceSummary(
  report: PressureEvidenceReport,
  options?: { artifactPath?: string },
): string {
  const lines = [
    "Pressure evidence summary:",
    `Project root: ${report.projectRoot}`,
    `Consultations scanned: ${report.consultationCount}`,
  ];

  if (options?.artifactPath) {
    lines.push(`Artifact: ${options.artifactPath}`);
  }

  lines.push(
    `Artifact coverage: preflight-readiness=${report.artifactCoverage.consultationsWithPreflightReadiness} preflight-fallback=${report.artifactCoverage.consultationsWithPreflightFallback} clarify-follow-up=${report.artifactCoverage.consultationsWithClarifyFollowUp} comparison=${report.artifactCoverage.consultationsWithComparisonReport} winner-selection=${report.artifactCoverage.consultationsWithWinnerSelection} failure-analysis=${report.artifactCoverage.consultationsWithFailureAnalysis} research-brief=${report.artifactCoverage.consultationsWithResearchBrief} manual-review=${report.artifactCoverage.consultationsWithManualReviewRecommendation}`,
  );
  lines.push(
    `Clarify pressure: total=${report.clarifyPressure.totalCases} needs-clarification=${report.clarifyPressure.needsClarificationCases} external-research-required=${report.clarifyPressure.externalResearchRequiredCases} repeated-tasks=${report.clarifyPressure.repeatedTasks.length} repeated-sources=${report.clarifyPressure.repeatedSources.length}`,
  );
  lines.push(
    `Clarify evidence coverage: targets=${report.clarifyPressure.artifactCoverage.casesWithTargetArtifact} preflight-readiness=${report.clarifyPressure.artifactCoverage.casesWithPreflightReadiness} preflight-fallback=${report.clarifyPressure.artifactCoverage.casesWithPreflightFallback} clarify-follow-up=${report.clarifyPressure.artifactCoverage.casesWithClarifyFollowUp} research-brief=${report.clarifyPressure.artifactCoverage.casesWithResearchBrief} manual-review=${report.clarifyPressure.artifactCoverage.casesWithManualReviewRecommendation}`,
  );
  lines.push(
    `Clarify metadata: validation-gaps=${report.clarifyPressure.metadataCoverage.consultationsWithValidationGaps} research-current=${report.clarifyPressure.metadataCoverage.consultationsWithCurrentResearchBasis} research-stale=${report.clarifyPressure.metadataCoverage.consultationsWithStaleResearchBasis} research-unknown=${report.clarifyPressure.metadataCoverage.consultationsWithUnknownResearchBasis} research-conflicts=${report.clarifyPressure.metadataCoverage.consultationsWithResearchConflicts} rerun=${report.clarifyPressure.metadataCoverage.consultationsWithResearchRerunRecommended}`,
  );
  if (report.clarifyPressure.missingArtifactBreakdown.length > 0) {
    lines.push(
      `Missing clarify artifacts: ${renderMissingArtifactBreakdown(report.clarifyPressure.missingArtifactBreakdown)}`,
    );
  }
  lines.push(
    `Clarify recent cluster: runs=${report.clarifyPressure.recentCluster.recentRunCount} window=${report.clarifyPressure.recentCluster.windowDays}d${report.clarifyPressure.recentCluster.latestRunId ? ` latest=${report.clarifyPressure.recentCluster.latestRunId}` : ""}`,
  );
  if (report.clarifyPressure.agentBreakdown.length > 0) {
    lines.push(`Clarify agents: ${renderAgentBreakdown(report.clarifyPressure.agentBreakdown)}`);
  }
  lines.push(
    `Clarify promotion signal: ${report.clarifyPressure.promotionSignal.shouldPromote ? "promote" : "hold"} (${report.clarifyPressure.promotionSignal.reasons.join("; ") || "no recurring clarify threshold met"})`,
  );
  lines.push(...renderBlindSpotPreview(report.clarifyPressure.coverageBlindSpots));
  lines.push(...renderInspectionQueue(report.clarifyPressure.inspectionQueue));
  lines.push(...renderCasePreview(report.clarifyPressure.cases));

  lines.push(
    `Finalist selection pressure: total=${report.finalistSelectionPressure.totalCases} finalists-without-recommendation=${report.finalistSelectionPressure.finalistsWithoutRecommendationCases} judge-abstain=${report.finalistSelectionPressure.judgeAbstainCases} manual-crowning=${report.finalistSelectionPressure.manualCrowningCases} low-confidence=${report.finalistSelectionPressure.lowConfidenceRecommendationCases} second-opinion-disagreement=${report.finalistSelectionPressure.secondOpinionDisagreementCases} repeated-tasks=${report.finalistSelectionPressure.repeatedTasks.length} repeated-sources=${report.finalistSelectionPressure.repeatedSources.length}`,
  );
  lines.push(
    `Finalist evidence coverage: targets=${report.finalistSelectionPressure.artifactCoverage.casesWithTargetArtifact} comparison=${report.finalistSelectionPressure.artifactCoverage.casesWithComparisonReport} winner-selection=${report.finalistSelectionPressure.artifactCoverage.casesWithWinnerSelection} failure-analysis=${report.finalistSelectionPressure.artifactCoverage.casesWithFailureAnalysis} research-brief=${report.finalistSelectionPressure.artifactCoverage.casesWithResearchBrief} manual-review=${report.finalistSelectionPressure.artifactCoverage.casesWithManualReviewRecommendation}`,
  );
  lines.push(
    `Finalist metadata: validation-gaps=${report.finalistSelectionPressure.metadataCoverage.consultationsWithValidationGaps} research-current=${report.finalistSelectionPressure.metadataCoverage.consultationsWithCurrentResearchBasis} research-stale=${report.finalistSelectionPressure.metadataCoverage.consultationsWithStaleResearchBasis} research-unknown=${report.finalistSelectionPressure.metadataCoverage.consultationsWithUnknownResearchBasis} research-conflicts=${report.finalistSelectionPressure.metadataCoverage.consultationsWithResearchConflicts} rerun=${report.finalistSelectionPressure.metadataCoverage.consultationsWithResearchRerunRecommended} judging-criteria=${report.finalistSelectionPressure.metadataCoverage.consultationsWithJudgingCriteria}`,
  );
  if (report.finalistSelectionPressure.missingArtifactBreakdown.length > 0) {
    lines.push(
      `Missing finalist artifacts: ${renderMissingArtifactBreakdown(report.finalistSelectionPressure.missingArtifactBreakdown)}`,
    );
  }
  lines.push(
    `Finalist recent cluster: runs=${report.finalistSelectionPressure.recentCluster.recentRunCount} window=${report.finalistSelectionPressure.recentCluster.windowDays}d${report.finalistSelectionPressure.recentCluster.latestRunId ? ` latest=${report.finalistSelectionPressure.recentCluster.latestRunId}` : ""}`,
  );
  if (report.finalistSelectionPressure.agentBreakdown.length > 0) {
    lines.push(
      `Finalist agents: ${renderAgentBreakdown(report.finalistSelectionPressure.agentBreakdown)}`,
    );
  }
  lines.push(
    `Finalist promotion signal: ${report.finalistSelectionPressure.promotionSignal.shouldPromote ? "promote" : "hold"} (${report.finalistSelectionPressure.promotionSignal.reasons.join("; ") || "no recurring finalist-selection threshold met"})`,
  );
  lines.push(...renderBlindSpotPreview(report.finalistSelectionPressure.coverageBlindSpots));
  lines.push(...renderInspectionQueue(report.finalistSelectionPressure.inspectionQueue));
  lines.push(...renderCasePreview(report.finalistSelectionPressure.cases));

  if (
    report.clarifyPressure.repeatedTasks.length > 0 ||
    report.finalistSelectionPressure.repeatedTasks.length > 0
  ) {
    lines.push("Repeated tasks:");
    for (const item of [
      ...report.clarifyPressure.repeatedTasks,
      ...report.finalistSelectionPressure.repeatedTasks,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.taskTitle}${item.targetArtifactPath ? ` (${item.targetArtifactPath})` : ""}: ${item.occurrenceCount} cases [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (
    report.clarifyPressure.repeatedSources.length > 0 ||
    report.finalistSelectionPressure.repeatedSources.length > 0
  ) {
    lines.push("Repeated task sources:");
    for (const item of [
      ...report.clarifyPressure.repeatedSources,
      ...report.finalistSelectionPressure.repeatedSources,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.taskSourcePath}: ${item.occurrenceCount} cases [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (report.finalistSelectionPressure.repeatedStrategySets.length > 0) {
    lines.push("Repeated finalist strategy sets:");
    for (const item of report.finalistSelectionPressure.repeatedStrategySets.slice(0, 6)) {
      lines.push(
        `- ${item.strategyLabels.join(" + ")}: ${item.occurrenceCount} consultations [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (report.finalistSelectionPressure.repeatedJudgingCriteriaSets.length > 0) {
    lines.push("Repeated judging criteria sets:");
    for (const item of report.finalistSelectionPressure.repeatedJudgingCriteriaSets.slice(0, 6)) {
      lines.push(
        `- ${item.judgingCriteria.join(" + ")}: ${item.occurrenceCount} consultations [${item.kinds.join(", ")}]`,
      );
    }
  }

  if (
    report.clarifyPressure.pressureTrajectories.length > 0 ||
    report.finalistSelectionPressure.pressureTrajectories.length > 0
  ) {
    lines.push("Pressure trajectories:");
    for (const item of [
      ...report.clarifyPressure.pressureTrajectories,
      ...report.finalistSelectionPressure.pressureTrajectories,
    ].slice(0, 6)) {
      lines.push(
        `- ${item.keyType} ${item.key} | agents=${item.agents.join(", ")} | span=${item.daySpanDays}d | escalation=${item.containsEscalation ? "yes" : "no"} | ${item.runs
          .map((run) => `${run.runId}[${run.kinds.join("+")}]`)
          .join(" -> ")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderCasePreview(cases: PressureEvidenceCase[]): string[] {
  if (cases.length === 0) {
    return ["- none"];
  }

  return cases.slice(0, 5).map((item) => {
    const suffix = item.question ?? item.summary;
    const artifactHint =
      item.artifactPaths.clarifyFollowUpPath ??
      item.artifactPaths.secondOpinionWinnerSelectionPath ??
      item.artifactPaths.failureAnalysisPath ??
      item.artifactPaths.winnerSelectionPath ??
      item.artifactPaths.preflightReadinessPath;
    return `- ${item.runId} | ${item.kind} | ${item.taskTitle} | ${suffix}${artifactHint ? ` | inspect: ${artifactHint}` : ""}`;
  });
}

function renderBlindSpotPreview(items: string[]): string[] {
  return items.map((item) => `- blind spot: ${item}`);
}

function renderInspectionQueue(items: PressureInspectionItem[]): string[] {
  return items.slice(0, 5).map((item) => `- inspect next: ${item.path} (${item.reason})`);
}

function renderAgentBreakdown(items: PressureAgentBreakdown[]): string {
  return items
    .map((item) => `${item.agent}=cases:${item.caseCount},consultations:${item.consultationCount}`)
    .join(" ");
}

function renderMissingArtifactBreakdown(items: PressureMissingArtifactBreakdown[]): string {
  return items.map((item) => `${item.artifactKind}=${item.consultationCount}`).join(" ");
}
