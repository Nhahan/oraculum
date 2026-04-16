import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../domain/profile.js";
import {
  buildSavedConsultationStatus,
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  isPreflightBlockedConsultation,
  type RunManifest,
} from "../../domain/run.js";
import { describeRecommendedTaskResultLabel, describeTaskResultLabel } from "../../domain/task.js";

import { resolveConsultationArtifacts } from "../consultation-artifacts.js";
import { RunStore } from "../run-store.js";

import {
  type ConsultationSurface,
  getSurfaceCommand,
  readSkippedProfileCommands,
  toDisplayPath,
} from "./shared.js";

export async function renderConsultationSummary(
  manifest: RunManifest,
  cwd: string,
  options?: {
    surface?: ConsultationSurface;
  },
): Promise<string> {
  void options?.surface;
  const store = new RunStore(cwd);
  const projectRoot = store.projectRoot;
  const runPaths = store.getRunPaths(manifest.id);
  const verdictCommand = getSurfaceCommand("verdict");
  const crownCommand = getSurfaceCommand("crown");
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );
  const resolvedArtifacts = await resolveConsultationArtifacts(projectRoot, manifest.id, {
    hasExportedCandidate: manifest.candidates.some((candidate) => candidate.status === "exported"),
  });
  const status = buildSavedConsultationStatus(manifest, {
    comparisonReportAvailable: resolvedArtifacts.comparisonReportAvailable,
    crowningRecordAvailable: resolvedArtifacts.crowningRecordAvailable,
    ...(resolvedArtifacts.manualReviewRequired ? { manualReviewRequired: true } : {}),
  });

  const lines = [
    `Consultation: ${manifest.id}`,
    `Opened: ${manifest.createdAt}`,
    `Task: ${manifest.taskPacket.title}`,
    `Task source: ${manifest.taskPacket.sourceKind} (${toDisplayPath(projectRoot, manifest.taskPacket.sourcePath)})`,
  ];
  const recommendedCandidateId = status.recommendedCandidateId;
  if (manifest.taskPacket.originKind && manifest.taskPacket.originPath) {
    lines.push(
      `Task origin: ${manifest.taskPacket.originKind} (${toDisplayPath(projectRoot, manifest.taskPacket.originPath)})`,
    );
  }
  if (manifest.taskPacket.artifactKind) {
    lines.push(`Artifact kind: ${manifest.taskPacket.artifactKind}`);
  }
  if (manifest.taskPacket.targetArtifactPath) {
    lines.push(
      `Target artifact: ${toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath)}`,
    );
  }
  lines.push(
    `Agent: ${manifest.agent}`,
    `Candidates: ${manifest.candidateCount}`,
    `Status: ${manifest.status}`,
    `Outcome: ${status.outcomeType}`,
    `Outcome detail: ${describeConsultationOutcomeSummary({
      outcomeType: status.outcomeType,
      ...(manifest.taskPacket.artifactKind
        ? { taskArtifactKind: manifest.taskPacket.artifactKind }
        : {}),
      ...(manifest.taskPacket.targetArtifactPath
        ? {
            targetArtifactPath: toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath),
          }
        : {}),
    })}`,
    `Judging basis: ${describeConsultationJudgingBasisSummary(status.judgingBasisKind)}`,
  );

  if (status.validationPosture !== "unknown") {
    lines.push(`Validation posture: ${status.validationPosture}`);
  }
  lines.push(`Verification level: ${status.verificationLevel}`);
  if (status.researchSignalCount > 0) {
    lines.push(`Research signal basis: ${status.researchSignalCount}`);
  }
  if (status.researchSignalFingerprint) {
    lines.push(`Research signal fingerprint: ${status.researchSignalFingerprint}`);
  }
  lines.push(`Research basis status: ${status.researchBasisStatus}`);
  if (status.researchBasisDrift !== undefined) {
    lines.push(`Research basis drift: ${status.researchBasisDrift ? "detected" : "not detected"}`);
  }
  if (status.researchConflictHandling) {
    lines.push(`Research conflict handling: ${status.researchConflictHandling}`);
  }
  const recommendedResultLabel = describeTaskResultLabel({
    ...(manifest.taskPacket.artifactKind ? { artifactKind: manifest.taskPacket.artifactKind } : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath) }
      : {}),
  });
  const crownableResultLabel = describeRecommendedTaskResultLabel({
    ...(manifest.taskPacket.artifactKind ? { artifactKind: manifest.taskPacket.artifactKind } : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? { targetArtifactPath: toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath) }
      : {}),
  });
  const hasExplicitResultIntent =
    Boolean(manifest.taskPacket.artifactKind) || Boolean(manifest.taskPacket.targetArtifactPath);
  const clarifyFollowUp = resolvedArtifacts.clarifyFollowUp;
  const clarifyFollowUpPath = resolvedArtifacts.clarifyFollowUpPath;
  const secondOpinionWinnerSelection = resolvedArtifacts.secondOpinionWinnerSelection;
  const secondOpinionWinnerSelectionPath = resolvedArtifacts.secondOpinionWinnerSelectionPath;

  if (manifest.preflight && manifest.preflight.decision !== "proceed") {
    lines.push(
      `Preflight: ${manifest.preflight.decision} (${manifest.preflight.confidence}, ${manifest.preflight.researchPosture})`,
      manifest.preflight.summary,
    );
    if (manifest.preflight.clarificationQuestion) {
      lines.push(`Clarification needed: ${manifest.preflight.clarificationQuestion}`);
    }
    if (manifest.preflight.researchQuestion) {
      lines.push(`Research needed: ${manifest.preflight.researchQuestion}`);
    }
    if (clarifyFollowUp) {
      lines.push(
        `Clarify follow-up: ${clarifyFollowUp.scopeKeyType} (${toDisplayPath(projectRoot, clarifyFollowUp.scopeKey)}, ${clarifyFollowUp.repeatedCaseCount} prior cases)`,
        clarifyFollowUp.summary,
        `Key clarify question: ${clarifyFollowUp.keyQuestion}`,
        `Missing result contract: ${clarifyFollowUp.missingResultContract}`,
        `Missing judging basis: ${clarifyFollowUp.missingJudgingBasis}`,
      );
    }
  }

  if (
    manifest.recommendedWinner &&
    manifest.recommendedWinner.candidateId === recommendedCandidateId
  ) {
    lines.push(
      `Recommended ${recommendedResultLabel}: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})`,
      manifest.recommendedWinner.summary,
    );
  } else if (recommendedCandidateId) {
    lines.push(`Recommended ${recommendedResultLabel}: ${recommendedCandidateId}`);
  }
  if (secondOpinionWinnerSelection) {
    lines.push(
      `Second-opinion judge: ${secondOpinionWinnerSelection.adapter} (${secondOpinionWinnerSelection.agreement})`,
      secondOpinionWinnerSelection.advisorySummary,
    );
  }
  if (manifest.profileSelection) {
    const validationProfileId = getValidationProfileId(manifest.profileSelection);
    const validationSummary =
      getValidationSummary(manifest.profileSelection) ??
      manifest.profileSelection.validationSummary;
    const validationSignals = getValidationSignals(manifest.profileSelection);
    const validationGaps = getValidationGaps(manifest.profileSelection);
    lines.push(
      `Auto validation posture: ${validationProfileId} (${manifest.profileSelection.confidence}, ${manifest.profileSelection.source})`,
      validationSummary,
    );
    if (validationSignals.length > 0) {
      lines.push(`Validation evidence: ${validationSignals.join(", ")}`);
    }
    if (validationGaps.length > 0) {
      lines.push(
        "Validation gaps from the selected posture:",
        ...validationGaps.map((item) => `- ${item}`),
      );
    }
    const skippedCommandCandidates = await readSkippedProfileCommands(projectRoot, manifest.id);
    if (skippedCommandCandidates.length > 0) {
      lines.push(
        "Skipped validation posture commands:",
        ...skippedCommandCandidates
          .slice(0, 5)
          .map((candidate) => `- ${candidate.id}: ${candidate.reason} - ${candidate.detail}`),
      );
      if (skippedCommandCandidates.length > 5) {
        lines.push(`- ${skippedCommandCandidates.length - 5} more in profile-selection.json`);
      }
    }
  }

  lines.push("Entry paths:");
  const consultationPlanPath = resolvedArtifacts.consultationPlanPath;
  const consultationPlanMarkdownPath = resolvedArtifacts.consultationPlanMarkdownPath;
  const preflightReadinessPath = resolvedArtifacts.preflightReadinessPath;
  const preflightReadiness = resolvedArtifacts.preflightReadiness;
  const researchBriefPath = resolvedArtifacts.researchBriefPath;
  const researchBrief = resolvedArtifacts.researchBrief;
  const failureAnalysisPath = resolvedArtifacts.failureAnalysisPath;
  const failureAnalysis = resolvedArtifacts.failureAnalysis;
  const profileSelectionPath = resolvedArtifacts.profileSelectionPath;
  const profileSelectionArtifact = resolvedArtifacts.profileSelection;
  const comparisonReportSummaryPath = resolvedArtifacts.comparisonMarkdownPath
    ? resolvedArtifacts.comparisonMarkdownPath
    : resolvedArtifacts.comparisonJsonPath;
  const winnerSelectionPath = resolvedArtifacts.winnerSelectionPath;
  const winnerSelection = resolvedArtifacts.winnerSelection;
  const preflightReadinessSummaryPath =
    preflightReadiness && preflightReadinessPath ? preflightReadinessPath : undefined;
  const consultationPlanSummaryPath =
    resolvedArtifacts.consultationPlan && consultationPlanPath ? consultationPlanPath : undefined;
  const consultationPlanMarkdownSummaryPath = consultationPlanMarkdownPath;
  const clarifyFollowUpSummaryPath =
    clarifyFollowUp && clarifyFollowUpPath ? clarifyFollowUpPath : undefined;
  const researchBriefSummaryPath =
    researchBrief && researchBriefPath ? researchBriefPath : undefined;
  const failureAnalysisSummaryPath =
    failureAnalysis && failureAnalysisPath ? failureAnalysisPath : undefined;
  const profileSelectionSummaryPath =
    profileSelectionArtifact && profileSelectionPath ? profileSelectionPath : undefined;
  const winnerSelectionSummaryPath =
    winnerSelection && winnerSelectionPath ? winnerSelectionPath : undefined;
  const secondOpinionWinnerSelectionSummaryPath =
    secondOpinionWinnerSelection && secondOpinionWinnerSelectionPath
      ? secondOpinionWinnerSelectionPath
      : undefined;
  lines.push(`- consultation root: ${toDisplayPath(projectRoot, runPaths.runDir)}`);
  lines.push(
    consultationPlanSummaryPath
      ? `- consultation plan: ${toDisplayPath(projectRoot, consultationPlanSummaryPath)}`
      : "- consultation plan: not available",
  );
  lines.push(
    consultationPlanMarkdownSummaryPath
      ? `- consultation plan summary: ${toDisplayPath(projectRoot, consultationPlanMarkdownSummaryPath)}`
      : "- consultation plan summary: not available",
  );
  lines.push(
    preflightReadinessSummaryPath
      ? `- preflight readiness: ${toDisplayPath(projectRoot, preflightReadinessSummaryPath)}`
      : "- preflight readiness: not available",
  );
  lines.push(
    clarifyFollowUpSummaryPath
      ? `- clarify follow-up: ${toDisplayPath(projectRoot, clarifyFollowUpSummaryPath)}`
      : "- clarify follow-up: not available",
  );
  lines.push(
    researchBriefSummaryPath
      ? `- research brief: ${toDisplayPath(projectRoot, researchBriefSummaryPath)}`
      : "- research brief: not available",
  );
  lines.push(
    failureAnalysisSummaryPath
      ? `- failure analysis: ${toDisplayPath(projectRoot, failureAnalysisSummaryPath)}`
      : "- failure analysis: not available",
  );
  lines.push(
    profileSelectionSummaryPath
      ? `- profile selection: ${toDisplayPath(projectRoot, profileSelectionSummaryPath)}`
      : "- profile selection: not available",
  );
  lines.push(
    comparisonReportSummaryPath
      ? `- comparison report: ${toDisplayPath(projectRoot, comparisonReportSummaryPath)}`
      : "- comparison report: not available yet",
  );
  lines.push(
    winnerSelectionSummaryPath
      ? `- winner selection: ${toDisplayPath(projectRoot, winnerSelectionSummaryPath)}`
      : "- winner selection: not available yet",
  );
  lines.push(
    secondOpinionWinnerSelectionSummaryPath
      ? `- second-opinion winner selection: ${toDisplayPath(projectRoot, secondOpinionWinnerSelectionSummaryPath)}`
      : "- second-opinion winner selection: not available",
  );

  const exportPlanPath = runPaths.exportPlanPath;
  const hasCrowningRecord = resolvedArtifacts.crowningRecordAvailable;
  lines.push(
    hasCrowningRecord
      ? `- crowning record: ${toDisplayPath(projectRoot, exportPlanPath)}`
      : "- crowning record: not created yet",
  );

  if (isPreflightBlockedConsultation(manifest) && manifest.candidates.length === 0) {
    lines.push("No candidates were generated because execution stopped at preflight.");
  } else if (finalists.length === 0) {
    lines.push(
      !hasExplicitResultIntent
        ? "No survivor yet. Candidate states:"
        : `No ${crownableResultLabel} yet. Candidate states:`,
    );
  } else {
    lines.push("Finalists:");
    for (const candidate of finalists) {
      lines.push(`- ${candidate.id}: ${candidate.strategyLabel}`);
    }
    lines.push("All candidates:");
  }

  for (const candidate of manifest.candidates) {
    lines.push(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})`);
  }

  lines.push("Next:");
  const researchBriefInputPath = resolveResearchBriefInputPath({
    manifest,
    projectRoot,
    currentResearchBriefExists: Boolean(researchBrief),
    ...(researchBriefPath ? { currentResearchBriefPath: researchBriefPath } : {}),
  });
  const consultationPlanInputPath = consultationPlanSummaryPath
    ? toDisplayPath(projectRoot, consultationPlanSummaryPath)
    : undefined;
  if (
    recommendedCandidateId &&
    secondOpinionWinnerSelection &&
    secondOpinionWinnerSelectionSummaryPath &&
    secondOpinionWinnerSelection.agreement !== "agrees-select"
  ) {
    lines.push(
      `- inspect the second-opinion judge before relying on the recommended result: ${toDisplayPath(projectRoot, secondOpinionWinnerSelectionSummaryPath)}.`,
    );
    lines.push("- perform manual review before materializing the recommended result.");
    if (hasCrowningRecord) {
      lines.push(`- reopen the crowning record: ${toDisplayPath(projectRoot, exportPlanPath)}`);
    }
  } else if (hasCrowningRecord) {
    lines.push(`- reopen the crowning record: ${toDisplayPath(projectRoot, exportPlanPath)}`);
  } else if (failureAnalysisSummaryPath) {
    lines.push(
      `- investigate the persisted failure analysis: ${toDisplayPath(projectRoot, failureAnalysisSummaryPath)}.`,
    );
  } else if (
    manifest.status === "planned" &&
    status.outcomeType === "pending-execution" &&
    consultationPlanInputPath
  ) {
    lines.push(
      `- execute the persisted consultation plan: \`orc consult ${consultationPlanInputPath}\`.`,
    );
    if (consultationPlanMarkdownSummaryPath) {
      lines.push(
        `- inspect the human-readable plan summary first: ${toDisplayPath(projectRoot, consultationPlanMarkdownSummaryPath)}.`,
      );
    }
  } else if (status.outcomeType === "needs-clarification") {
    if (clarifyFollowUp && clarifyFollowUpSummaryPath) {
      lines.push(
        `- inspect the persisted clarify follow-up: ${toDisplayPath(projectRoot, clarifyFollowUpSummaryPath)}.`,
      );
      lines.push(`- answer the key clarify question: ${clarifyFollowUp.keyQuestion}`);
    } else {
      lines.push("- answer the preflight clarification question, then rerun `orc consult`.");
    }
    lines.push(
      "- rerun `orc consult` once the missing result contract and judging basis are explicit.",
    );
  } else if (status.outcomeType === "external-research-required") {
    const researchBriefInput = researchBriefInputPath
      ? `orc consult ${researchBriefInputPath}`
      : "orc consult";
    if (clarifyFollowUp && clarifyFollowUpSummaryPath) {
      lines.push(
        `- inspect the persisted clarify follow-up: ${toDisplayPath(projectRoot, clarifyFollowUpSummaryPath)}.`,
      );
      lines.push(`- gather bounded external evidence for: ${clarifyFollowUp.keyQuestion}`);
      lines.push(
        `- use this missing result contract when refreshing the brief: ${clarifyFollowUp.missingResultContract}`,
      );
      lines.push(
        `- use this missing judging basis when refreshing the brief: ${clarifyFollowUp.missingJudgingBasis}`,
      );
    } else {
      lines.push("- gather the required external evidence.");
    }
    if (status.researchBasisDrift) {
      lines.push(
        "- refresh the persisted research brief because its signal basis no longer matches the current repository.",
      );
      lines.push(
        `- rerun from the persisted research brief after refreshing evidence: \`${researchBriefInput}\`.`,
      );
    } else {
      lines.push(
        `- rerun from the persisted research brief when ready: \`${researchBriefInput}\`.`,
      );
    }
  } else if (status.outcomeType === "abstained-before-execution") {
    lines.push("- revise the task scope or repository setup, then rerun `orc consult`.");
  } else if (recommendedCandidateId) {
    const recommendedCandidate = manifest.candidates.find(
      (candidate) => candidate.id === recommendedCandidateId,
    );
    const crownTarget =
      recommendedCandidate?.workspaceMode === "copy"
        ? crownCommand
        : `${crownCommand} <branch-name>`;
    lines.push(`- crown the ${crownableResultLabel}: ${crownTarget}`);
  } else if (manifest.status === "completed" && finalists.length > 0) {
    lines.push(
      comparisonReportSummaryPath
        ? `- inspect the comparison first. The shared \`${crownCommand}\` path only crowns a ${crownableResultLabel}.`
        : `- compare the surviving finalists manually before crowning because no comparison report is available yet.`,
    );
  } else if (manifest.status === "completed") {
    lines.push(
      comparisonReportSummaryPath
        ? "- review why no candidate survived the oracle rounds: open the comparison report above."
        : "- review why no candidate survived the oracle rounds.",
    );
  } else {
    lines.push(`- reopen this consultation later: ${verdictCommand} ${manifest.id}`);
  }
  if (status.researchBasisDrift && status.outcomeType !== "external-research-required") {
    lines.push(
      "- refresh the persisted external research because its signal basis no longer matches the current repository.",
    );
    if (researchBriefInputPath) {
      lines.push(
        `- rerun from the persisted research brief after refreshing evidence: \`orc consult ${researchBriefInputPath}\`.`,
      );
    }
  }
  lines.push(`- reopen the latest consultation later: ${verdictCommand}`);
  lines.push(`- browse recent consultations: ${verdictCommand} archive`);

  return `${lines.join("\n")}\n`;
}

function resolveResearchBriefInputPath(options: {
  manifest: RunManifest;
  projectRoot: string;
  currentResearchBriefPath?: string;
  currentResearchBriefExists: boolean;
}): string | undefined {
  if (options.manifest.taskPacket.sourceKind === "research-brief") {
    return toDisplayPath(options.projectRoot, options.manifest.taskPacket.sourcePath);
  }
  if (options.currentResearchBriefExists && options.currentResearchBriefPath) {
    return toDisplayPath(options.projectRoot, options.currentResearchBriefPath);
  }
  return undefined;
}
