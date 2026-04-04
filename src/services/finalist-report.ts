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
import {
  type CandidateManifest,
  candidateStatusSchema,
  type RunRecommendation,
  runRecommendationSchema,
} from "../domain/run.js";
import { taskPacketSummarySchema } from "../domain/task.js";

import { buildFinalistSummaries } from "./finalists.js";
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
}

const comparisonReportSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string().min(1),
  agent: z.string().min(1),
  task: taskPacketSummarySchema,
  finalistCount: z.number().int().min(0),
  recommendedWinner: runRecommendationSchema.optional(),
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
  const finalists = buildFinalistSummaries(
    options.candidates,
    options.candidateResults,
    options.verdictsByCandidate,
  );
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  const report = comparisonReportSchema.parse({
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    agent: options.agent,
    task: options.taskPacket,
    finalistCount: finalists.length,
    ...(options.recommendedWinner ? { recommendedWinner: options.recommendedWinner } : {}),
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
      `- Recommended winner: ${report.recommendedWinner.candidateId} (${report.recommendedWinner.confidence}, ${report.recommendedWinner.source})`,
      `- Recommendation summary: ${report.recommendedWinner.summary}`,
    );
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
      `- Verdict counts: pass=${finalist.verdictCounts.pass}, repairable=${finalist.verdictCounts.repairable}, fail=${finalist.verdictCounts.fail}, warning=${finalist.verdictCounts.warning}, error=${finalist.verdictCounts.error}, critical=${finalist.verdictCounts.critical}`,
    );

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
