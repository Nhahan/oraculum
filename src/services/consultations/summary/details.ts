import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../../domain/profile.js";
import {
  describeConsultationJudgingBasisSummary,
  describeConsultationOutcomeSummary,
  isPreflightBlockedConsultation,
} from "../../../domain/run.js";
import { readSkippedProfileCommands, toDisplayPath } from "../shared.js";
import type { ConsultationSummaryContext } from "./types.js";

export async function buildConsultationSummaryDetailLines(
  context: ConsultationSummaryContext,
): Promise<string[]> {
  const { manifest, projectRoot, recommendedCandidateId, resolvedArtifacts, status } = context;
  const lines = [
    `Consultation: ${manifest.id}`,
    `Opened: ${manifest.createdAt}`,
    `Task: ${manifest.taskPacket.title}`,
    `Task source: ${manifest.taskPacket.sourceKind} (${toDisplayPath(projectRoot, manifest.taskPacket.sourcePath)})`,
  ];

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
    if (resolvedArtifacts.clarifyFollowUp) {
      lines.push(
        `Clarify follow-up: ${resolvedArtifacts.clarifyFollowUp.scopeKeyType} (${toDisplayPath(projectRoot, resolvedArtifacts.clarifyFollowUp.scopeKey)}, ${resolvedArtifacts.clarifyFollowUp.repeatedCaseCount} prior cases)`,
        resolvedArtifacts.clarifyFollowUp.summary,
        `Key clarify question: ${resolvedArtifacts.clarifyFollowUp.keyQuestion}`,
        `Missing result contract: ${resolvedArtifacts.clarifyFollowUp.missingResultContract}`,
        `Missing judging basis: ${resolvedArtifacts.clarifyFollowUp.missingJudgingBasis}`,
      );
    }
  }

  if (
    manifest.recommendedWinner &&
    manifest.recommendedWinner.candidateId === recommendedCandidateId
  ) {
    lines.push(
      `Recommended ${context.recommendedResultLabel}: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})`,
      manifest.recommendedWinner.summary,
    );
  } else if (recommendedCandidateId) {
    lines.push(`Recommended ${context.recommendedResultLabel}: ${recommendedCandidateId}`);
  }

  if (resolvedArtifacts.secondOpinionWinnerSelection) {
    lines.push(
      `Second-opinion judge: ${resolvedArtifacts.secondOpinionWinnerSelection.adapter} (${resolvedArtifacts.secondOpinionWinnerSelection.agreement})`,
      resolvedArtifacts.secondOpinionWinnerSelection.advisorySummary,
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

  if (isPreflightBlockedConsultation(manifest) && manifest.candidates.length === 0) {
    lines.push("No candidates were generated because execution stopped at preflight.");
  } else if (context.finalists.length === 0) {
    lines.push(
      !context.hasExplicitResultIntent
        ? "No survivor yet. Candidate states:"
        : `No ${context.crownableResultLabel} yet. Candidate states:`,
    );
  } else {
    lines.push("Finalists:");
    for (const candidate of context.finalists) {
      lines.push(`- ${candidate.id}: ${candidate.strategyLabel}`);
    }
    lines.push("All candidates:");
  }

  for (const candidate of manifest.candidates) {
    lines.push(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})`);
  }

  return lines;
}
