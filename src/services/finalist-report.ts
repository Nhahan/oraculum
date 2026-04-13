import { writeFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { z } from "zod";

import { type AgentRunResult, finalistSummarySchema } from "../adapters/types.js";
import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  resolveProjectRoot,
} from "../core/paths.js";
import type { Adapter, ManagedTreeRules } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import {
  consultationProfileSelectionSchema,
  getValidationGaps,
  getValidationProfileId,
  getValidationSignals,
  getValidationSummary,
} from "../domain/profile.js";
import {
  type CandidateManifest,
  candidateStatusSchema,
  type consultationPreflightSchema,
  consultationVerificationLevelSchema,
  type RunRecommendation,
  runRecommendationSchema,
} from "../domain/run.js";
import {
  describeRecommendedTaskResultLabel,
  type TaskPacketSummary,
  taskPacketSummarySchema,
} from "../domain/task.js";

import { buildEnrichedFinalistSummaries } from "./finalist-insights.js";
import { writeJsonFile } from "./project.js";

interface WriteFinalistComparisonReportOptions {
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  projectRoot: string;
  recommendedWinner?: RunRecommendation;
  runId: string;
  taskPacket: TaskPacketSummary;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
  agent: Adapter;
  preflight?: z.infer<typeof consultationPreflightSchema>;
  consultationProfile?: z.infer<typeof consultationProfileSelectionSchema>;
  verificationLevel: z.infer<typeof consultationVerificationLevelSchema>;
  managedTreeRules?: ManagedTreeRules;
}

const comparisonReportSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  agent: z.string().min(1),
  task: taskPacketSummarySchema,
  targetResultLabel: z.string().min(1),
  finalistCount: z.number().int().min(0),
  recommendedWinner: runRecommendationSchema.optional(),
  whyThisWon: z.string().min(1).optional(),
  validationProfileId: z.string().min(1).optional(),
  validationSummary: z.string().min(1).optional(),
  validationSignals: z.array(z.string().min(1)).default([]),
  validationGaps: z.array(z.string().min(1)).default([]),
  researchBasisDrift: z.boolean().optional(),
  researchRerunRecommended: z.boolean(),
  researchRerunInputPath: z.string().min(1).optional(),
  consultationProfile: consultationProfileSelectionSchema.optional(),
  verificationLevel: consultationVerificationLevelSchema,
  finalists: z.array(
    finalistSummarySchema.extend({
      status: candidateStatusSchema,
      verdictCounts: z.object({
        pass: z.number().int().min(0),
        repairable: z.number().int().min(0),
        fail: z.number().int().min(0),
        skip: z.number().int().min(0),
        info: z.number().int().min(0),
        warning: z.number().int().min(0),
        error: z.number().int().min(0),
        critical: z.number().int().min(0),
      }),
    }),
  ),
});

type ComparisonReport = z.infer<typeof comparisonReportSchema>;

export async function writeFinalistComparisonReport(
  options: WriteFinalistComparisonReportOptions,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const displayTargetArtifactPath = options.taskPacket.targetArtifactPath
    ? toDisplayPath(projectRoot, options.taskPacket.targetArtifactPath)
    : undefined;
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    ...(options.managedTreeRules ? { managedTreeRules: options.managedTreeRules } : {}),
    verdictsByCandidate: options.verdictsByCandidate,
  });
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const researchRerunInputPath =
    options.taskPacket.sourceKind === "research-brief" ? options.taskPacket.sourcePath : undefined;
  const researchRerunRecommended = options.preflight?.researchBasisDrift === true;
  const report = comparisonReportSchema.parse({
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    agent: options.agent,
    task: options.taskPacket,
    targetResultLabel: describeRecommendedTaskResultLabel({
      ...(options.taskPacket.artifactKind ? { artifactKind: options.taskPacket.artifactKind } : {}),
      ...(displayTargetArtifactPath ? { targetArtifactPath: displayTargetArtifactPath } : {}),
    }),
    finalistCount: finalists.length,
    ...(options.recommendedWinner ? { recommendedWinner: options.recommendedWinner } : {}),
    ...(options.recommendedWinner ? { whyThisWon: options.recommendedWinner.summary } : {}),
    ...(getValidationProfileId(options.consultationProfile)
      ? { validationProfileId: getValidationProfileId(options.consultationProfile) }
      : {}),
    ...(getValidationSummary(options.consultationProfile)
      ? { validationSummary: getValidationSummary(options.consultationProfile) }
      : {}),
    validationSignals: getValidationSignals(options.consultationProfile),
    validationGaps: getValidationGaps(options.consultationProfile),
    ...(options.preflight?.researchBasisDrift !== undefined
      ? { researchBasisDrift: options.preflight.researchBasisDrift }
      : {}),
    researchRerunRecommended,
    ...(researchRerunInputPath ? { researchRerunInputPath } : {}),
    ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
    verificationLevel: options.verificationLevel,
    finalists: finalists.map((finalist) => ({
      ...finalist,
      status: candidateById.get(finalist.candidateId)?.status ?? "planned",
      verdictCounts: countVerdicts(finalist.verdicts),
    })),
  });

  const jsonPath = getFinalistComparisonJsonPath(projectRoot, options.runId);
  const markdownPath = getFinalistComparisonMarkdownPath(projectRoot, options.runId);
  await writeJsonFile(jsonPath, report);
  await writeFile(markdownPath, buildComparisonMarkdown(report, projectRoot), "utf8");

  return { jsonPath, markdownPath };
}

function countVerdicts(
  verdicts: Array<{
    status: string;
    severity: string;
  }>,
): ComparisonReport["finalists"][number]["verdictCounts"] {
  const counts = {
    pass: 0,
    repairable: 0,
    fail: 0,
    skip: 0,
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };

  for (const verdict of verdicts) {
    if (verdict.status === "pass") {
      counts.pass += 1;
    } else if (verdict.status === "repairable") {
      counts.repairable += 1;
    } else if (verdict.status === "fail") {
      counts.fail += 1;
    } else if (verdict.status === "skip") {
      counts.skip += 1;
    }

    if (verdict.severity === "info") {
      counts.info += 1;
    } else if (verdict.severity === "warning") {
      counts.warning += 1;
    } else if (verdict.severity === "error") {
      counts.error += 1;
    } else if (verdict.severity === "critical") {
      counts.critical += 1;
    }
  }

  return counts;
}

function buildComparisonMarkdown(report: ComparisonReport, projectRoot: string): string {
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
    lines.push(`- Research signal basis: ${report.task.researchContext.signalSummary.length}`);
    if (report.task.researchContext.signalFingerprint) {
      lines.push(`- Research signal fingerprint: ${report.task.researchContext.signalFingerprint}`);
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
