import { writeFile } from "node:fs/promises";
import { z } from "zod";

import { type AgentRunResult, finalistSummarySchema } from "../adapters/types.js";
import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  resolveProjectRoot,
} from "../core/paths.js";
import type { Adapter } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import { consultationProfileSelectionSchema } from "../domain/profile.js";
import {
  type CandidateManifest,
  candidateStatusSchema,
  type RunRecommendation,
  runRecommendationSchema,
} from "../domain/run.js";
import { taskPacketSummarySchema } from "../domain/task.js";

import { buildEnrichedFinalistSummaries } from "./finalist-insights.js";
import { writeJsonFile } from "./project.js";

interface WriteFinalistComparisonReportOptions {
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  projectRoot: string;
  recommendedWinner?: RunRecommendation;
  runId: string;
  taskPacket: {
    id: string;
    title: string;
    sourceKind: "task-note" | "task-packet";
    sourcePath: string;
  };
  verdictsByCandidate: Map<string, OracleVerdict[]>;
  agent: Adapter;
  consultationProfile?: z.infer<typeof consultationProfileSelectionSchema>;
}

const comparisonReportSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  agent: z.string().min(1),
  task: taskPacketSummarySchema,
  finalistCount: z.number().int().min(0),
  recommendedWinner: runRecommendationSchema.optional(),
  whyThisWon: z.string().min(1).optional(),
  consultationProfile: consultationProfileSelectionSchema.optional(),
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
  const finalists = await buildEnrichedFinalistSummaries({
    candidates: options.candidates,
    candidateResults: options.candidateResults,
    verdictsByCandidate: options.verdictsByCandidate,
  });
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const report = comparisonReportSchema.parse({
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    agent: options.agent,
    task: options.taskPacket,
    finalistCount: finalists.length,
    ...(options.recommendedWinner ? { recommendedWinner: options.recommendedWinner } : {}),
    ...(options.recommendedWinner ? { whyThisWon: options.recommendedWinner.summary } : {}),
    ...(options.consultationProfile ? { consultationProfile: options.consultationProfile } : {}),
    finalists: finalists.map((finalist) => ({
      ...finalist,
      status: candidateById.get(finalist.candidateId)?.status ?? "planned",
      verdictCounts: countVerdicts(finalist.verdicts),
    })),
  });

  const jsonPath = getFinalistComparisonJsonPath(projectRoot, options.runId);
  const markdownPath = getFinalistComparisonMarkdownPath(projectRoot, options.runId);
  await writeJsonFile(jsonPath, report);
  await writeFile(markdownPath, buildComparisonMarkdown(report), "utf8");

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

function buildComparisonMarkdown(report: ComparisonReport): string {
  const lines: string[] = [
    "# Finalist Comparison",
    "",
    `- Run: ${report.runId}`,
    `- Task: ${report.task.title}`,
    `- Agent: ${report.agent}`,
    `- Finalists: ${report.finalistCount}`,
  ];

  if (report.recommendedWinner) {
    lines.push(
      "",
      "## Recommended Promotion",
      `- Candidate: ${report.recommendedWinner.candidateId}`,
      `- Confidence: ${report.recommendedWinner.confidence}`,
      `- Source: ${report.recommendedWinner.source}`,
      `- Why this won: ${report.whyThisWon ?? report.recommendedWinner.summary}`,
    );
  }

  if (report.consultationProfile) {
    lines.push(
      "",
      "## Consultation Profile",
      `- Profile: ${report.consultationProfile.profileId}`,
      `- Confidence: ${report.consultationProfile.confidence}`,
      `- Source: ${report.consultationProfile.source}`,
      `- Summary: ${report.consultationProfile.summary}`,
    );
    if (report.consultationProfile.missingCapabilities.length > 0) {
      lines.push(
        "- Validation gaps:",
        ...report.consultationProfile.missingCapabilities.map((item) => `  - ${item}`),
      );
    }
  }

  if (report.finalists.length === 0) {
    lines.push("", "No finalists survived this run.");
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
