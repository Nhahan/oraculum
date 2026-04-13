import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

import {
  getExportPlanPath,
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
  type ProfileSkippedCommandCandidate,
  profileRepoSignalsSchema,
} from "../domain/profile.js";
import {
  buildSavedConsultationStatus,
  isPreflightBlockedConsultation,
  type RunManifest,
} from "../domain/run.js";

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
    `Agent: ${manifest.agent}`,
    `Candidates: ${manifest.candidateCount}`,
    `Status: ${manifest.status}`,
    `Outcome: ${status.outcomeType}`,
  ];

  if (status.validationPosture !== "unknown") {
    lines.push(`Validation posture: ${status.validationPosture}`);
  }
  lines.push(`Verification level: ${status.verificationLevel}`);

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

  if (manifest.recommendedWinner) {
    lines.push(
      `Recommended survivor: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})`,
      manifest.recommendedWinner.summary,
    );
  }
  if (manifest.profileSelection) {
    lines.push(
      `Auto profile: ${manifest.profileSelection.profileId} (${manifest.profileSelection.confidence}, ${manifest.profileSelection.source})`,
      manifest.profileSelection.summary,
    );
    if (manifest.profileSelection.missingCapabilities.length > 0) {
      lines.push(
        "Profile gaps:",
        ...manifest.profileSelection.missingCapabilities.map((item) => `- ${item}`),
      );
    }
    const skippedCommandCandidates = await readSkippedProfileCommands(projectRoot, manifest.id);
    if (skippedCommandCandidates.length > 0) {
      lines.push(
        "Skipped profile commands:",
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
  const preflightReadinessPath = getPreflightReadinessPath(projectRoot, manifest.id);
  const researchBriefPath = getResearchBriefPath(projectRoot, manifest.id);
  const profileSelectionPath = getProfileSelectionPath(projectRoot, manifest.id);
  const winnerSelectionPath = getWinnerSelectionPath(projectRoot, manifest.id);
  const preflightReadinessExists = await pathExists(preflightReadinessPath);
  const researchBriefExists = await pathExists(researchBriefPath);
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
    lines.push("No survivor yet. Candidate states:");
  } else {
    lines.push("Survivors:");
    for (const candidate of finalists) {
      lines.push(`- ${candidate.id}: ${candidate.strategyLabel}`);
    }
    lines.push("All candidates:");
  }

  for (const candidate of manifest.candidates) {
    lines.push(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})`);
  }

  lines.push("Next:");
  if (hasCrowningRecord) {
    lines.push(`- reopen the crowning record: ${toDisplayPath(projectRoot, exportPlanPath)}`);
  } else if (status.outcomeType === "needs-clarification") {
    lines.push("- answer the preflight clarification question, then rerun `orc consult`.");
  } else if (status.outcomeType === "external-research-required") {
    lines.push("- gather the required external evidence, then rerun `orc consult`.");
  } else if (status.outcomeType === "abstained-before-execution") {
    lines.push("- revise the task scope or repository setup, then rerun `orc consult`.");
  } else if (manifest.recommendedWinner) {
    const recommendedCandidate = manifest.candidates.find(
      (candidate) => candidate.id === manifest.recommendedWinner?.candidateId,
    );
    const crownTarget =
      recommendedCandidate?.workspaceMode === "copy"
        ? crownCommand
        : `${crownCommand} <branch-name>`;
    lines.push(`- crown the recommended survivor: ${crownTarget}`);
  } else if (manifest.status === "completed" && finalists.length > 0) {
    lines.push(
      `- inspect the comparison first. The shared \`${crownCommand}\` path only crowns a recommended survivor.`,
    );
  } else if (manifest.status === "completed") {
    lines.push(
      "- review why no candidate survived the oracle rounds: open the comparison report above.",
    );
  } else {
    lines.push(`- reopen this consultation later: ${verdictCommand} ${manifest.id}`);
  }
  lines.push(`- reopen the latest consultation later: ${verdictCommand}`);
  lines.push(`- browse recent consultations: ${verdictCommand} archive`);

  return `${lines.join("\n")}\n`;
}

export function buildVerdictReview(
  manifest: RunManifest,
  artifacts: {
    preflightReadinessPath?: string;
    researchBriefPath?: string;
    profileSelectionPath?: string;
    comparisonJsonPath?: string;
    comparisonMarkdownPath?: string;
    winnerSelectionPath?: string;
    crowningRecordPath?: string;
  },
): VerdictReview {
  const status = buildSavedConsultationStatus(manifest);
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

  return {
    outcomeType: status.outcomeType,
    verificationLevel: status.verificationLevel,
    validationPosture: status.validationPosture,
    judgingBasisKind: status.judgingBasisKind,
    ...(status.recommendedCandidateId
      ? { recommendedCandidateId: status.recommendedCandidateId }
      : {}),
    finalistIds,
    ...(manifest.profileSelection ? { profileId: manifest.profileSelection.profileId } : {}),
    profileMissingCapabilities: manifest.profileSelection?.missingCapabilities ?? [],
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
      profileSelection: Boolean(artifacts.profileSelectionPath),
      comparisonReport: Boolean(artifacts.comparisonJsonPath || artifacts.comparisonMarkdownPath),
      winnerSelection: Boolean(artifacts.winnerSelectionPath),
      crowningRecord: Boolean(artifacts.crowningRecordPath),
    },
    candidateStateCounts,
  };
}

export function renderConsultationArchive(
  manifests: RunManifest[],
  options?: {
    surface?: ConsultationSurface;
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
    const recommendation = renderArchiveOutcomeSummary(manifest, status);
    const profile = manifest.profileSelection
      ? `profile ${manifest.profileSelection.profileId}`
      : "no auto profile";
    lines.push(
      `- ${manifest.id} | ${manifest.status} | ${manifest.taskPacket.title} | ${profile} | ${recommendation}`,
      `  opened: ${manifest.createdAt}`,
      `  reopen: ${verdictCommand} ${manifest.id}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderArchiveOutcomeSummary(
  manifest: RunManifest,
  status: ReturnType<typeof buildSavedConsultationStatus>,
): string {
  if (manifest.recommendedWinner) {
    return `survivor ${manifest.recommendedWinner.candidateId}`;
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
      return "no survivors";
    default:
      return "no survivor yet";
  }
}

function toDisplayPath(projectRoot: string, targetPath: string): string {
  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  return display.length > 0 ? display : ".";
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
