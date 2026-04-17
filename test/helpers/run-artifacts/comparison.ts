import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
} from "../../../src/core/paths.js";
import { comparisonReportSchema } from "../../../src/services/finalist-report.js";

import { writeJsonArtifact, writeTextArtifact } from "../fs.js";

import { ensureRunReportsDir } from "./core.js";

export async function writeComparisonReportJson(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getFinalistComparisonJsonPath(cwd, runId),
    comparisonReportSchema.parse({
      runId,
      generatedAt: "2026-04-04T00:00:00.000Z",
      agent: "codex",
      task: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      targetResultLabel: "recommended result",
      finalistCount: 0,
      researchRerunRecommended: false,
      verificationLevel: "standard",
      finalists: [],
      ...overrides,
    }),
  );
}

export async function writeComparisonReportMarkdown(
  cwd: string,
  runId: string,
  contents: string,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeTextArtifact(getFinalistComparisonMarkdownPath(cwd, runId), contents);
}

export async function writeComparisonArtifacts(
  cwd: string,
  runId: string,
  options?: {
    jsonOverrides?: Record<string, unknown>;
    markdownContents?: string;
  },
): Promise<void> {
  await writeComparisonReportJson(cwd, runId, options?.jsonOverrides);
  await writeComparisonReportMarkdown(
    cwd,
    runId,
    options?.markdownContents ?? `# Finalist Comparison\n\n- Run: ${runId}\n`,
  );
}
