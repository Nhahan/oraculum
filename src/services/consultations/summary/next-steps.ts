import type { RunManifest } from "../../../domain/run.js";
import { toDisplayPath } from "../shared.js";
import type { ConsultationSummaryContext, ConsultationSummaryPathState } from "./types.js";

export function buildConsultationSummaryNextStepLines(
  context: ConsultationSummaryContext,
  pathState: ConsultationSummaryPathState,
): string[] {
  const { manifest, projectRoot, recommendedCandidateId, resolvedArtifacts, status } = context;
  const lines = ["Next:"];
  const researchBriefInputPath = resolveResearchBriefInputPath({
    currentResearchBriefExists: Boolean(resolvedArtifacts.researchBrief),
    ...(resolvedArtifacts.researchBriefPath
      ? { currentResearchBriefPath: resolvedArtifacts.researchBriefPath }
      : {}),
    manifest,
    projectRoot,
  });
  const consultationPlanInputPath = pathState.consultationPlanSummaryPath
    ? toDisplayPath(projectRoot, pathState.consultationPlanSummaryPath)
    : undefined;

  if (
    recommendedCandidateId &&
    resolvedArtifacts.secondOpinionWinnerSelection &&
    pathState.secondOpinionWinnerSelectionSummaryPath &&
    resolvedArtifacts.secondOpinionWinnerSelection.agreement !== "agrees-select"
  ) {
    lines.push(
      `- inspect the second-opinion judge before relying on the recommended result: ${toDisplayPath(projectRoot, pathState.secondOpinionWinnerSelectionSummaryPath)}.`,
    );
    lines.push("- perform manual review before materializing the recommended result.");
    if (pathState.hasCrowningRecord) {
      lines.push(
        `- reopen the crowning record: ${toDisplayPath(projectRoot, pathState.exportPlanPath)}`,
      );
    }
  } else if (pathState.hasCrowningRecord) {
    lines.push(
      `- reopen the crowning record: ${toDisplayPath(projectRoot, pathState.exportPlanPath)}`,
    );
  } else if (pathState.failureAnalysisSummaryPath) {
    lines.push(
      `- investigate the persisted failure analysis: ${toDisplayPath(projectRoot, pathState.failureAnalysisSummaryPath)}.`,
    );
  } else if (
    manifest.status === "planned" &&
    status.outcomeType === "pending-execution" &&
    consultationPlanInputPath
  ) {
    lines.push(
      `- execute the persisted consultation plan: \`orc consult ${consultationPlanInputPath}\`.`,
    );
    if (pathState.consultationPlanMarkdownSummaryPath) {
      lines.push(
        `- inspect the human-readable plan summary first: ${toDisplayPath(projectRoot, pathState.consultationPlanMarkdownSummaryPath)}.`,
      );
    }
  } else if (status.outcomeType === "needs-clarification") {
    if (resolvedArtifacts.clarifyFollowUp && pathState.clarifyFollowUpSummaryPath) {
      lines.push(
        `- inspect the persisted clarify follow-up: ${toDisplayPath(projectRoot, pathState.clarifyFollowUpSummaryPath)}.`,
      );
      lines.push(
        `- answer the key clarify question: ${resolvedArtifacts.clarifyFollowUp.keyQuestion}`,
      );
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
    if (resolvedArtifacts.clarifyFollowUp && pathState.clarifyFollowUpSummaryPath) {
      lines.push(
        `- inspect the persisted clarify follow-up: ${toDisplayPath(projectRoot, pathState.clarifyFollowUpSummaryPath)}.`,
      );
      lines.push(
        `- gather bounded external evidence for: ${resolvedArtifacts.clarifyFollowUp.keyQuestion}`,
      );
      lines.push(
        `- use this missing result contract when refreshing the brief: ${resolvedArtifacts.clarifyFollowUp.missingResultContract}`,
      );
      lines.push(
        `- use this missing judging basis when refreshing the brief: ${resolvedArtifacts.clarifyFollowUp.missingJudgingBasis}`,
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
        ? context.crownCommand
        : `${context.crownCommand} <branch-name>`;
    lines.push(`- crown the ${context.crownableResultLabel}: ${crownTarget}`);
  } else if (manifest.status === "completed" && context.finalists.length > 0) {
    lines.push(
      pathState.comparisonReportSummaryPath
        ? `- inspect the comparison first. The shared \`${context.crownCommand}\` path only crowns a ${context.crownableResultLabel}.`
        : `- compare the surviving finalists manually before crowning because no comparison report is available yet.`,
    );
  } else if (manifest.status === "completed") {
    lines.push(
      pathState.comparisonReportSummaryPath
        ? "- review why no candidate survived the oracle rounds: open the comparison report above."
        : "- review why no candidate survived the oracle rounds.",
    );
  } else {
    lines.push(`- reopen this consultation later: ${context.verdictCommand} ${manifest.id}`);
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

  lines.push(`- reopen the latest consultation later: ${context.verdictCommand}`);
  lines.push(`- browse recent consultations: ${context.verdictCommand} archive`);

  return lines;
}

function resolveResearchBriefInputPath(options: {
  currentResearchBriefExists: boolean;
  currentResearchBriefPath?: string;
  manifest: RunManifest;
  projectRoot: string;
}): string | undefined {
  if (options.manifest.taskPacket.sourceKind === "research-brief") {
    return toDisplayPath(options.projectRoot, options.manifest.taskPacket.sourcePath);
  }
  if (options.currentResearchBriefExists && options.currentResearchBriefPath) {
    return toDisplayPath(options.projectRoot, options.currentResearchBriefPath);
  }
  return undefined;
}
