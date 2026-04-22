import { writeJsonFile, writeTextFileAtomically } from "../../project.js";
import { RunStore } from "../../run-store.js";

import { buildConsultationPlanArtifact } from "./build.js";
import { renderConsultationPlanMarkdown } from "./markdown.js";
import { buildConsultationPlanReadiness } from "./readiness.js";
import type { ConsultationPlanArtifactWriterOptions } from "./types.js";

export async function writeConsultationPlanArtifacts(
  options: ConsultationPlanArtifactWriterOptions,
): Promise<void> {
  const runPaths = new RunStore(options.projectRoot).getRunPaths(options.runId);
  const planPath = runPaths.consultationPlanPath;
  const markdownPath = runPaths.consultationPlanMarkdownPath;
  const readinessPath = runPaths.consultationPlanReadinessPath;
  const reviewPath = runPaths.consultationPlanReviewPath;
  const planArtifact = buildConsultationPlanArtifact(options);
  const readinessArtifact = buildConsultationPlanReadiness({
    consultationPlan: planArtifact,
    ...(options.planReview ? { review: options.planReview } : {}),
  });

  await writeJsonFile(planPath, planArtifact);
  await writeJsonFile(readinessPath, readinessArtifact);
  if (options.planReview) {
    await writeJsonFile(reviewPath, options.planReview);
  }
  await writeTextFileAtomically(
    markdownPath,
    `${renderConsultationPlanMarkdown(planArtifact, options.projectRoot)}\n`,
  );
}
