import { writeFile } from "node:fs/promises";

import { writeJsonFile } from "../../project.js";
import { RunStore } from "../../run-store.js";

import { buildConsultationPlanArtifact } from "./build.js";
import { renderConsultationPlanMarkdown } from "./markdown.js";
import type { ConsultationPlanArtifactWriterOptions } from "./types.js";

export async function writeConsultationPlanArtifacts(
  options: ConsultationPlanArtifactWriterOptions,
): Promise<void> {
  const runPaths = new RunStore(options.projectRoot).getRunPaths(options.runId);
  const planPath = runPaths.consultationPlanPath;
  const markdownPath = runPaths.consultationPlanMarkdownPath;
  const planArtifact = buildConsultationPlanArtifact(options);

  await writeJsonFile(planPath, planArtifact);
  await writeFile(
    markdownPath,
    `${renderConsultationPlanMarkdown(planArtifact, options.projectRoot)}\n`,
    "utf8",
  );
}
