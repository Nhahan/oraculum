import type { z } from "zod";

import { getClarifyFollowUpPath, getFailureAnalysisPath } from "../../../src/core/paths.js";
import { consultationClarifyFollowUpSchema } from "../../../src/domain/run.js";
import { failureAnalysisSchema } from "../../../src/services/failure-analysis.js";

import { writeJsonArtifact } from "../fs.js";

import { ensureRunReportsDir } from "./core.js";

export async function writeFailureAnalysis(
  cwd: string,
  runId: string,
  value: z.input<typeof failureAnalysisSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getFailureAnalysisPath(cwd, runId), failureAnalysisSchema.parse(value));
}

export async function writeClarifyFollowUp(
  cwd: string,
  runId: string,
  value: z.input<typeof consultationClarifyFollowUpSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getClarifyFollowUpPath(cwd, runId),
    consultationClarifyFollowUpSchema.parse(value),
  );
}
