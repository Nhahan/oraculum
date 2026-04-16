import {
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../../domain/profile.js";

import { toDisplayPath } from "./display-path.js";
import type { ComparisonReport } from "./schema.js";

export function buildComparisonMarkdown(report: ComparisonReport, projectRoot: string): string {
  const taskSourcePath = toDisplayPath(projectRoot, report.task.sourcePath);
  const taskOriginPath = report.task.originPath
    ? toDisplayPath(projectRoot, report.task.originPath)
    : undefined;
  const targetArtifactPath = report.task.targetArtifactPath
    ? toDisplayPath(projectRoot, report.task.targetArtifactPath)
    : undefined;
  const researchRerunInputPath = report.researchRerunInputPath
    ? toDisplayPath(projectRoot, report.researchRerunInputPath)
    : undefined;
  const lines: string[] = [
    "# Finalist Comparison",
    "",
    `- Run: ${report.runId}`,
    `- Task: ${report.task.title}`,
  ];

  if (report.task.originKind && taskOriginPath) {
    lines.push(`- Task origin: ${report.task.originKind} (${taskOriginPath})`);
  }

  lines.push(`- Target result: ${report.targetResultLabel}`);

  if (report.task.artifactKind) {
    lines.push(`- Artifact kind: ${report.task.artifactKind}`);
  }
  if (targetArtifactPath) {
    lines.push(`- Target artifact: ${targetArtifactPath}`);
  }

  lines.push(
    `- Task source: ${report.task.sourceKind} (${taskSourcePath})`,
    `- Agent: ${report.agent}`,
    `- Finalists: ${report.finalistCount}`,
    `- Verification level: ${report.verificationLevel}`,
  );

  if (report.task.researchContext?.summary) {
    lines.push(`- Research summary: ${report.task.researchContext.summary}`);
  }
  if (report.task.researchContext?.confidence) {
    lines.push(`- Research confidence: ${report.task.researchContext.confidence}`);
  }
  if (report.task.researchContext) {
    lines.push(`- Research basis status: ${report.researchBasisStatus}`);
    lines.push(`- Research signal basis: ${report.task.researchContext.signalSummary.length}`);
    if (report.task.researchContext.signalFingerprint) {
      lines.push(`- Research signal fingerprint: ${report.task.researchContext.signalFingerprint}`);
    }
    if (report.researchConflictHandling) {
      lines.push(`- Research conflict handling: ${report.researchConflictHandling}`);
    }
    lines.push(`- Research sources: ${report.task.researchContext.sources.length}`);
    lines.push(`- Research claims: ${report.task.researchContext.claims.length}`);
    lines.push(`- Research version notes: ${report.task.researchContext.versionNotes.length}`);
    lines.push(`- Research conflicts: ${report.task.researchContext.unresolvedConflicts.length}`);
    if (report.researchBasisDrift !== undefined) {
      lines.push(
        `- Research basis drift: ${report.researchBasisDrift ? "detected" : "not detected"}`,
      );
    }
    if (report.researchRerunRecommended && researchRerunInputPath) {
      lines.push(`- Research rerun input: ${researchRerunInputPath}`);
    }
  }

  if (report.recommendedWinner) {
    lines.push(
      "",
      "## Recommended Result",
      `- Candidate: ${report.recommendedWinner.candidateId}`,
      `- Confidence: ${report.recommendedWinner.confidence}`,
      `- Source: ${report.recommendedWinner.source}`,
      `- Why this won: ${report.whyThisWon ?? report.recommendedWinner.summary}`,
    );
  }

  const validationProfileId =
    report.validationProfileId ??
    (report.consultationProfile ? getValidationProfileId(report.consultationProfile) : undefined);
  const validationSummary =
    report.validationSummary ??
    (report.consultationProfile
      ? (getValidationSummary(report.consultationProfile) ??
        report.consultationProfile.validationSummary)
      : undefined);
  const validationSignals =
    report.validationSignals.length > 0
      ? report.validationSignals
      : report.consultationProfile
        ? getValidationSignals(report.consultationProfile)
        : [];
  const validationGaps =
    report.validationGaps.length > 0
      ? report.validationGaps
      : report.consultationProfile
        ? getValidationGaps(report.consultationProfile)
        : [];

  if (
    validationProfileId ||
    validationSummary ||
    validationSignals.length > 0 ||
    validationGaps.length > 0
  ) {
    lines.push(
      "",
      "## Consultation Validation Posture",
      `- Validation posture: ${validationProfileId ?? "unknown"}`,
    );
    if (report.consultationProfile) {
      lines.push(`- Confidence: ${report.consultationProfile.confidence}`);
      lines.push(`- Source: ${report.consultationProfile.source}`);
    }
    if (validationSummary) {
      lines.push(`- Summary: ${validationSummary}`);
    }
    if (validationSignals.length > 0) {
      lines.push(`- Validation evidence: ${validationSignals.join(", ")}`);
    }
    if (validationGaps.length > 0) {
      lines.push("- Validation gaps:", ...validationGaps.map((item) => `  - ${item}`));
    }
  }

  if (report.finalists.length === 0) {
    lines.push("", "No finalists cleared this run.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "## Finalists");

  for (const finalist of report.finalists) {
    lines.push(
      "",
      `### ${finalist.candidateId} — ${finalist.strategyLabel}`,
      `- Status: ${finalist.status}`,
      `- Agent summary: ${finalist.summary}`,
      `- Artifacts: ${finalist.artifactKinds.join(", ") || "none"}`,
      `- Changed paths: ${renderChangedPathSummary(finalist)}`,
      `- Change detail: ${renderChangeDetail(finalist)}`,
      `- Repair attempts: ${finalist.repairSummary.attemptCount} (${finalist.repairSummary.repairedRounds.join(", ") || "none"})`,
      `- Verdict counts: pass=${finalist.verdictCounts.pass}, repairable=${finalist.verdictCounts.repairable}, fail=${finalist.verdictCounts.fail}, warning=${finalist.verdictCounts.warning}, error=${finalist.verdictCounts.error}, critical=${finalist.verdictCounts.critical}`,
    );

    if (finalist.witnessRollup.riskSummaries.length > 0) {
      lines.push(
        "- Risk snapshot:",
        ...finalist.witnessRollup.riskSummaries.slice(0, 5).map((risk) => `  - ${risk}`),
      );
    }

    if (finalist.witnessRollup.repairHints.length > 0) {
      lines.push(
        "- Repair hints:",
        ...finalist.witnessRollup.repairHints.map((hint) => `  - ${hint}`),
      );
    }

    if (finalist.changedPaths.length > 0) {
      lines.push(
        "- Changed paths:",
        ...finalist.changedPaths.slice(0, 12).map((path) => `  - ${path}`),
      );
    }

    if (finalist.witnessRollup.keyWitnesses.length > 0) {
      lines.push(
        "- Key witnesses:",
        ...finalist.witnessRollup.keyWitnesses.map(
          (witness) =>
            `  - [${witness.roundId}] ${witness.oracleId}: ${witness.title} — ${witness.detail}`,
        ),
      );
    }

    if (finalist.verdicts.length > 0) {
      lines.push("", "Verdicts:");
      for (const verdict of finalist.verdicts) {
        lines.push(
          `- [${verdict.roundId}] ${verdict.oracleId}: ${verdict.status}/${verdict.severity} — ${verdict.summary}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderChangedPathSummary(finalist: ComparisonReport["finalists"][number]): string {
  if (finalist.changeSummary.changedPathCount === 0) {
    return "no captured changes";
  }

  const preview = finalist.changedPaths.slice(0, 3).join(", ");
  const suffix =
    finalist.changedPaths.length > 3 ? `, +${finalist.changedPaths.length - 3} more` : "";
  return `${finalist.changeSummary.changedPathCount} (${preview}${suffix})`;
}

function renderChangeDetail(finalist: ComparisonReport["finalists"][number]): string {
  const detail = [
    `mode=${finalist.changeSummary.mode}`,
    `created=${finalist.changeSummary.createdPathCount}`,
    `removed=${finalist.changeSummary.removedPathCount}`,
    `modified=${finalist.changeSummary.modifiedPathCount}`,
  ];

  if (finalist.changeSummary.addedLineCount !== undefined) {
    detail.push(`+${finalist.changeSummary.addedLineCount}`);
  }
  if (finalist.changeSummary.deletedLineCount !== undefined) {
    detail.push(`-${finalist.changeSummary.deletedLineCount}`);
  }

  return detail.join(", ");
}
