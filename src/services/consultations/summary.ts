import { buildSavedConsultationStatus, type RunManifest } from "../../domain/run.js";
import { describeRecommendedTaskResultLabel, describeTaskResultLabel } from "../../domain/task.js";

import { resolveConsultationArtifacts } from "../consultation-artifacts.js";
import { isPlanConsensusRemediationEligible } from "../plan-consensus/index.js";
import { RunStore } from "../run-store.js";

import { type ConsultationSurface, getSurfaceCommand, toDisplayPath } from "./shared.js";
import { buildConsultationSummaryDetailLines } from "./summary/details.js";
import { buildConsultationSummaryEntryPathLines } from "./summary/entry-paths.js";
import { buildConsultationSummaryNextStepLines } from "./summary/next-steps.js";
import { buildConsultationSummaryPathState } from "./summary/paths.js";
import type { ConsultationArtifacts, ConsultationSummaryContext } from "./summary/types.js";

export async function renderConsultationSummary(
  manifest: RunManifest,
  cwd: string,
  options?: {
    resolvedArtifacts?: ConsultationArtifacts;
    surface?: ConsultationSurface;
  },
): Promise<string> {
  const store = new RunStore(cwd);
  const projectRoot = store.projectRoot;
  const runPaths = store.getRunPaths(manifest.id);
  const verdictCommand = getSurfaceCommand("verdict");
  const crownCommand = getSurfaceCommand("crown");
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );
  const resolvedArtifacts =
    options?.resolvedArtifacts ??
    (await resolveConsultationArtifacts(projectRoot, manifest.id, {
      hasExportedCandidate: manifest.candidates.some(
        (candidate) => candidate.status === "exported",
      ),
    }));
  const status = buildSavedConsultationStatus(manifest, {
    comparisonReportAvailable: resolvedArtifacts.comparisonReportAvailable,
    crowningRecordAvailable: resolvedArtifacts.crowningRecordAvailable,
    ...(resolvedArtifacts.manualReviewRequired ? { manualReviewRequired: true } : {}),
    planConclaveRemediationRecommended: resolvedArtifacts.planConsensus
      ? isPlanConsensusRemediationEligible(resolvedArtifacts.planConsensus)
      : false,
  });
  const recommendedCandidateId = status.recommendedCandidateId;
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
  const context: ConsultationSummaryContext = {
    crownCommand,
    crownableResultLabel,
    cwd,
    finalists,
    hasExplicitResultIntent,
    manifest,
    ...(options?.surface ? { options: { surface: options.surface } } : {}),
    projectRoot,
    ...(recommendedCandidateId ? { recommendedCandidateId } : {}),
    recommendedResultLabel,
    resolvedArtifacts,
    runPaths,
    status,
    verdictCommand,
  };
  const pathState = buildConsultationSummaryPathState(context);
  const lines = [
    ...(await buildConsultationSummaryDetailLines(context)),
    ...buildConsultationSummaryEntryPathLines(context, pathState),
    ...buildConsultationSummaryNextStepLines(context, pathState),
  ];

  return `${lines.join("\n")}\n`;
}
