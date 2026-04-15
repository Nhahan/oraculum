import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { z } from "zod";

import type { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getExportPlanPath,
  getRunDir,
  getRunManifestPath,
  getRunsDir,
  resolveProjectRoot,
} from "../core/paths.js";
import type { VerdictReview } from "../domain/chat-native.js";
import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
  type ProfileSkippedCommandCandidate,
} from "../domain/profile.js";
import type { consultationClarifyFollowUpSchema } from "../domain/run.js";
import {
  buildSavedConsultationStatus,
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  isPreflightBlockedConsultation,
  type RunManifest,
} from "../domain/run.js";
import {
  deriveResearchBasisStatus,
  deriveResearchConflictHandling,
  describeRecommendedTaskResultLabel,
  describeTaskResultLabel,
} from "../domain/task.js";
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
  resolveConsultationArtifacts,
  resolveConsultationArtifactsSync,
} from "./consultation-artifacts.js";
import type { secondOpinionWinnerSelectionArtifactSchema } from "./finalist-judge.js";
import type { comparisonReportSchema } from "./finalist-report.js";
import { pathExists } from "./project.js";
import { parseRunManifestArtifact } from "./run-manifest-artifact.js";

type ConsultationSurface = "chat-native";

export async function listRecentConsultations(cwd: string, limit = 10): Promise<RunManifest[]> {
  const projectRoot = resolveProjectRoot(cwd);
  const runsDir = getRunsDir(projectRoot);

  if (!(await pathExists(runsDir))) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = getRunManifestPath(projectRoot, entry.name);
        if (!(await pathExists(manifestPath))) {
          return undefined;
        }

        try {
          return parseRunManifestArtifact(
            JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
          );
        } catch {
          return undefined;
        }
      }),
  );

  return manifests
    .filter((manifest): manifest is RunManifest => Boolean(manifest))
    .sort((left, right) => {
      const timeDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

export async function renderConsultationSummary(
  manifest: RunManifest,
  cwd: string,
  options?: {
    surface?: ConsultationSurface;
  },
): Promise<string> {
  void options;
  const projectRoot = resolveProjectRoot(cwd);
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
  lines.push(
    `- consultation root: ${toDisplayPath(projectRoot, getRunDir(projectRoot, manifest.id))}`,
  );
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

  const exportPlanPath = getExportPlanPath(projectRoot, manifest.id);
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

export function renderConsultationArchive(
  manifests: RunManifest[],
  options?: {
    surface?: ConsultationSurface;
    projectRoot?: string;
  },
): string {
  void options;
  const consultCommand = getSurfaceCommand("consult");
  const verdictCommand = getSurfaceCommand("verdict");

  if (manifests.length === 0) {
    return `No consultations yet. Start with \`${consultCommand} ...\`.\n`;
  }

  const lines = ["Recent consultations:"];
  for (const manifest of manifests) {
    const resolvedArtifacts = options?.projectRoot
      ? resolveConsultationArtifactsSync(options.projectRoot, manifest.id, {
          hasExportedCandidate: manifest.candidates.some(
            (candidate) => candidate.status === "exported",
          ),
        })
      : undefined;
    const secondOpinionAgreement = resolvedArtifacts?.secondOpinionWinnerSelection?.agreement;
    const status = buildSavedConsultationStatus(manifest, {
      ...(resolvedArtifacts
        ? { comparisonReportAvailable: resolvedArtifacts.comparisonReportAvailable }
        : {}),
      ...(resolvedArtifacts
        ? { crowningRecordAvailable: resolvedArtifacts.crowningRecordAvailable }
        : {}),
      ...(resolvedArtifacts?.manualReviewRequired ? { manualReviewRequired: true } : {}),
    });
    const recommendation = renderArchiveOutcomeSummary(
      manifest,
      status,
      options?.projectRoot,
      secondOpinionAgreement,
    );
    const artifact = renderArchiveArtifactSummary(manifest, options?.projectRoot);
    const profile = getValidationProfileId(manifest.profileSelection)
      ? `validation posture ${getValidationProfileId(manifest.profileSelection)}`
      : "no auto validation posture";
    lines.push(
      `- ${manifest.id} | ${manifest.status} | ${manifest.taskPacket.title}${artifact ? ` | ${artifact}` : ""} | ${profile} | ${recommendation}`,
      `  opened: ${manifest.createdAt}`,
      `  reopen: ${verdictCommand} ${manifest.id}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderArchiveOutcomeSummary(
  manifest: RunManifest,
  status: ReturnType<typeof buildSavedConsultationStatus>,
  projectRoot?: string,
  secondOpinionAgreement?: z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>["agreement"],
): string {
  const hasExplicitResultIntent =
    Boolean(manifest.taskPacket.artifactKind) || Boolean(manifest.taskPacket.targetArtifactPath);
  const recommendedResultLabel = describeRecommendedTaskResultLabel({
    ...(manifest.taskPacket.artifactKind ? { artifactKind: manifest.taskPacket.artifactKind } : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? {
          targetArtifactPath: projectRoot
            ? toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath)
            : manifest.taskPacket.targetArtifactPath,
        }
      : {}),
  });

  if (status.recommendedCandidateId) {
    return secondOpinionAgreement && secondOpinionAgreement !== "agrees-select"
      ? `${recommendedResultLabel} ${status.recommendedCandidateId} (manual review)`
      : `${recommendedResultLabel} ${status.recommendedCandidateId}`;
  }

  switch (status.outcomeType) {
    case "pending-execution":
      return "pending execution";
    case "running":
      return "running";
    case "needs-clarification":
      return "needs clarification";
    case "external-research-required":
      return "external research required";
    case "abstained-before-execution":
      return "abstained before execution";
    case "finalists-without-recommendation":
      return "finalists without recommendation";
    case "completed-with-validation-gaps":
      return "completed with validation gaps";
    case "no-survivors":
      return !hasExplicitResultIntent ? "no survivors" : `no ${recommendedResultLabel} yet`;
    default:
      return `no ${recommendedResultLabel} yet`;
  }
}

function renderArchiveArtifactSummary(
  manifest: RunManifest,
  projectRoot?: string,
): string | undefined {
  const targetArtifactPath = manifest.taskPacket.targetArtifactPath
    ? projectRoot
      ? toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath)
      : manifest.taskPacket.targetArtifactPath
    : undefined;

  if (!manifest.taskPacket.artifactKind && !manifest.taskPacket.targetArtifactPath) {
    return undefined;
  }

  if (manifest.taskPacket.artifactKind && targetArtifactPath) {
    return `artifact ${manifest.taskPacket.artifactKind} @ ${targetArtifactPath}`;
  }

  if (manifest.taskPacket.artifactKind) {
    return `artifact ${manifest.taskPacket.artifactKind}`;
  }

  return `artifact @ ${targetArtifactPath}`;
}

function toDisplayPath(projectRoot: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) {
    return targetPath.replaceAll("\\", "/");
  }

  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  if (display.length === 0) {
    return ".";
  }

  if (display === ".." || display.startsWith("../") || isAbsolute(display)) {
    return targetPath.replaceAll("\\", "/");
  }

  return display;
}

function getSurfaceCommand(command: "consult" | "verdict" | "crown"): string {
  return `orc ${command}`;
}

async function readSkippedProfileCommands(
  projectRoot: string,
  runId: string,
): Promise<ProfileSkippedCommandCandidate[]> {
  const artifacts = await resolveConsultationArtifacts(projectRoot, runId);
  return artifacts.profileSelection?.signals.skippedCommandCandidates ?? [];
}
