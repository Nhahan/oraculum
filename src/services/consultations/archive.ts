import type { z } from "zod";

import { getValidationProfileId } from "../../domain/profile.js";
import { buildSavedConsultationStatus, type RunManifest } from "../../domain/run.js";
import { describeRecommendedTaskResultLabel } from "../../domain/task.js";

import { resolveConsultationArtifactsSync } from "../consultation-artifacts.js";
import type { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";

import { type ConsultationArchiveRecord, isInvalidConsultationRecord } from "./list.js";
import { type ConsultationSurface, getSurfaceCommand, toDisplayPath } from "./shared.js";

export function renderConsultationArchive(
  records: ConsultationArchiveRecord[],
  options?: {
    surface?: ConsultationSurface;
    projectRoot?: string;
  },
): string {
  void options?.surface;
  const consultCommand = getSurfaceCommand("consult");
  const verdictCommand = getSurfaceCommand("verdict");

  if (records.length === 0) {
    return `No consultations yet. Start with \`${consultCommand} ...\`.\n`;
  }

  const lines = ["Recent consultations:"];
  for (const record of records) {
    if (isInvalidConsultationRecord(record)) {
      lines.push(
        `- ${record.id} | invalid consultation record | ${toArchiveDisplayPath(record.manifestPath, options?.projectRoot)} | ${record.diagnostic.message}`,
        `  path: ${toArchiveDisplayPath(record.manifestPath, options?.projectRoot)}`,
      );
      continue;
    }

    const manifest = record;
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

function toArchiveDisplayPath(path: string, projectRoot?: string): string {
  return projectRoot ? toDisplayPath(projectRoot, path) : path;
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
