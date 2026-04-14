import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { z } from "zod";

import { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunDir,
  getRunManifestPath,
  getRunsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import type { VerdictReview } from "../domain/chat-native.js";
import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
  type ProfileSkippedCommandCandidate,
  profileRepoSignalsSchema,
} from "../domain/profile.js";
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

import { comparisonReportSchema } from "./finalist-report.js";
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
  const status = buildSavedConsultationStatus(manifest);
  const verdictCommand = getSurfaceCommand("verdict");
  const crownCommand = getSurfaceCommand("crown");
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );

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
  const comparisonReportPath = getFinalistComparisonMarkdownPath(projectRoot, manifest.id);
  const failureAnalysisPath = getFailureAnalysisPath(projectRoot, manifest.id);
  const preflightReadinessPath = getPreflightReadinessPath(projectRoot, manifest.id);
  const researchBriefPath = getResearchBriefPath(projectRoot, manifest.id);
  const profileSelectionPath = getProfileSelectionPath(projectRoot, manifest.id);
  const winnerSelectionPath = getWinnerSelectionPath(projectRoot, manifest.id);
  const preflightReadinessExists = await pathExists(preflightReadinessPath);
  const researchBriefExists = await pathExists(researchBriefPath);
  const failureAnalysisExists = await pathExists(failureAnalysisPath);
  const profileSelectionExists = await pathExists(profileSelectionPath);
  const comparisonReportExists = await pathExists(comparisonReportPath);
  const winnerSelectionExists = await pathExists(winnerSelectionPath);
  lines.push(
    `- consultation root: ${toDisplayPath(projectRoot, getRunDir(projectRoot, manifest.id))}`,
  );
  lines.push(
    preflightReadinessExists
      ? `- preflight readiness: ${toDisplayPath(projectRoot, preflightReadinessPath)}`
      : "- preflight readiness: not available",
  );
  lines.push(
    researchBriefExists
      ? `- research brief: ${toDisplayPath(projectRoot, researchBriefPath)}`
      : "- research brief: not available",
  );
  lines.push(
    failureAnalysisExists
      ? `- failure analysis: ${toDisplayPath(projectRoot, failureAnalysisPath)}`
      : "- failure analysis: not available",
  );
  lines.push(
    profileSelectionExists
      ? `- profile selection: ${toDisplayPath(projectRoot, profileSelectionPath)}`
      : "- profile selection: not available",
  );
  lines.push(
    comparisonReportExists
      ? `- comparison report: ${toDisplayPath(projectRoot, comparisonReportPath)}`
      : "- comparison report: not available yet",
  );
  lines.push(
    winnerSelectionExists
      ? `- winner selection: ${toDisplayPath(projectRoot, winnerSelectionPath)}`
      : "- winner selection: not available yet",
  );

  const exportPlanPath = getExportPlanPath(projectRoot, manifest.id);
  const hasExportedCandidate = manifest.candidates.some(
    (candidate) => candidate.status === "exported",
  );
  const hasCrowningRecord = hasExportedCandidate && (await pathExists(exportPlanPath));
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
    currentResearchBriefPath: researchBriefPath,
    currentResearchBriefExists: researchBriefExists,
  });
  if (hasCrowningRecord) {
    lines.push(`- reopen the crowning record: ${toDisplayPath(projectRoot, exportPlanPath)}`);
  } else if (failureAnalysisExists) {
    lines.push(
      `- investigate the persisted failure analysis: ${toDisplayPath(projectRoot, failureAnalysisPath)}.`,
    );
  } else if (status.outcomeType === "needs-clarification") {
    lines.push("- answer the preflight clarification question, then rerun `orc consult`.");
  } else if (status.outcomeType === "external-research-required") {
    const researchBriefInput = researchBriefInputPath
      ? `orc consult ${researchBriefInputPath}`
      : "orc consult";
    lines.push("- gather the required external evidence.");
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
      `- inspect the comparison first. The shared \`${crownCommand}\` path only crowns a ${crownableResultLabel}.`,
    );
  } else if (manifest.status === "completed") {
    lines.push(
      "- review why no candidate survived the oracle rounds: open the comparison report above.",
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
  currentResearchBriefPath: string;
  currentResearchBriefExists: boolean;
}): string | undefined {
  if (options.manifest.taskPacket.sourceKind === "research-brief") {
    return toDisplayPath(options.projectRoot, options.manifest.taskPacket.sourcePath);
  }
  if (options.currentResearchBriefExists) {
    return toDisplayPath(options.projectRoot, options.currentResearchBriefPath);
  }
  return undefined;
}

export async function buildVerdictReview(
  manifest: RunManifest,
  artifacts: {
    preflightReadinessPath?: string;
    researchBriefPath?: string;
    failureAnalysisPath?: string;
    profileSelectionPath?: string;
    comparisonJsonPath?: string;
    comparisonMarkdownPath?: string;
    winnerSelectionPath?: string;
    crowningRecordPath?: string;
  },
): Promise<VerdictReview> {
  const status = buildSavedConsultationStatus(manifest);
  const comparisonReport = await readComparisonReport(artifacts.comparisonJsonPath);
  const winnerSelection = await readWinnerSelectionResult(artifacts.winnerSelectionPath);
  const researchRerunInputPath =
    manifest.taskPacket.sourceKind === "research-brief"
      ? manifest.taskPacket.sourcePath
      : artifacts.researchBriefPath;
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
    comparisonReport,
    manifest,
    reviewFinalistIds,
    status,
    validationSignals,
    validationSummary,
  });
  const recommendationSummary =
    status.outcomeType === "recommended-survivor"
      ? (comparisonReport?.whyThisWon ?? manifest.recommendedWinner?.summary)
      : undefined;
  const judgingCriteria = winnerSelection?.recommendation?.judgingCriteria;
  const recommendationAbsenceReason = buildRecommendationAbsenceReason({
    status,
    validationGaps,
    winnerSelection,
  });
  const weakestEvidence = buildReviewWeakestEvidence({
    manifest,
    recommendationAbsenceReason,
    status,
    validationGaps,
  });
  const manualCrowningCandidateIds =
    status.outcomeType === "finalists-without-recommendation" ? reviewFinalistIds : [];
  const manualReviewRecommended =
    status.outcomeType === "finalists-without-recommendation" ||
    status.outcomeType === "completed-with-validation-gaps" ||
    status.outcomeType === "needs-clarification" ||
    status.outcomeType === "external-research-required";
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
    ...(judgingCriteria?.length ? { judgingCriteria } : {}),
    ...(recommendationSummary ? { recommendationSummary } : {}),
    ...(recommendationAbsenceReason ? { recommendationAbsenceReason } : {}),
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
    artifactAvailability: {
      preflightReadiness: Boolean(artifacts.preflightReadinessPath),
      researchBrief: Boolean(artifacts.researchBriefPath),
      failureAnalysis: Boolean(artifacts.failureAnalysisPath),
      profileSelection: Boolean(artifacts.profileSelectionPath),
      comparisonReport: Boolean(artifacts.comparisonJsonPath || artifacts.comparisonMarkdownPath),
      winnerSelection: Boolean(artifacts.winnerSelectionPath),
      crowningRecord: Boolean(artifacts.crowningRecordPath),
    },
    candidateStateCounts,
  };
}

function buildReviewStrongestEvidence(options: {
  comparisonReport: z.infer<typeof comparisonReportSchema> | undefined;
  manifest: RunManifest;
  reviewFinalistIds: string[];
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
  if (options.manifest.taskPacket.researchContext?.summary) {
    add(options.manifest.taskPacket.researchContext.summary);
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
  manifest: RunManifest;
  recommendationAbsenceReason: string | undefined;
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

async function readComparisonReport(
  comparisonJsonPath: string | undefined,
): Promise<z.infer<typeof comparisonReportSchema> | undefined> {
  if (!comparisonJsonPath) {
    return undefined;
  }

  try {
    return comparisonReportSchema.parse(
      JSON.parse(await readFile(comparisonJsonPath, "utf8")) as unknown,
    );
  } catch {
    return undefined;
  }
}

async function readWinnerSelectionResult(
  winnerSelectionPath: string | undefined,
): Promise<z.infer<typeof agentJudgeResultSchema> | undefined> {
  if (!winnerSelectionPath) {
    return undefined;
  }

  try {
    return agentJudgeResultSchema.parse(
      JSON.parse(await readFile(winnerSelectionPath, "utf8")) as unknown,
    );
  } catch {
    return undefined;
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
    const status = buildSavedConsultationStatus(manifest);
    const recommendation = renderArchiveOutcomeSummary(manifest, status, options?.projectRoot);
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
    return `${recommendedResultLabel} ${status.recommendedCandidateId}`;
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
  const profileSelectionPath = getProfileSelectionPath(projectRoot, runId);
  if (!(await pathExists(profileSelectionPath))) {
    return [];
  }

  try {
    const raw = JSON.parse(await readFile(profileSelectionPath, "utf8")) as { signals?: unknown };
    const signals = profileRepoSignalsSchema.safeParse(raw.signals);
    return signals.success ? signals.data.skippedCommandCandidates : [];
  } catch {
    return [];
  }
}
