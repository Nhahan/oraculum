import type { Command } from "commander";

import { getFinalistComparisonMarkdownPath } from "../core/paths.js";
import type { RunManifest } from "../domain/run.js";
import { readLatestRunManifest, readRunManifest } from "../services/runs.js";

export function registerVerdictCommand(program: Command): void {
  const verdict = program
    .command("verdict")
    .description("Reopen the latest verdict or inspect a specific consultation.")
    .argument("[consultation-id]", "consultation identifier; defaults to the latest consultation")
    .action(async (consultationId?: string) => {
      await writeVerdict(consultationId);
    });

  verdict
    .command("consultation")
    .description("Inspect a specific consultation by id.")
    .argument("<consultation-id>", "consultation identifier")
    .action(async (consultationId: string) => {
      await writeVerdict(consultationId);
    });
}

async function writeVerdict(consultationId?: string): Promise<void> {
  const manifest = consultationId
    ? await readRunManifest(process.cwd(), consultationId)
    : await readLatestRunManifest(process.cwd());
  process.stdout.write(renderVerdict(manifest, process.cwd()));
}

export function renderVerdict(manifest: RunManifest, cwd: string): string {
  const lines = [
    `Consultation: ${manifest.id}`,
    `Task: ${manifest.taskPacket.title}`,
    `Agent: ${manifest.agent}`,
    `Candidates: ${manifest.candidateCount}`,
    `Status: ${manifest.status}`,
  ];
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );

  if (manifest.recommendedWinner) {
    lines.push(
      `Recommended promotion: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})`,
      manifest.recommendedWinner.summary,
    );
  }

  lines.push(
    manifest.status === "completed"
      ? `Comparison report: ${getFinalistComparisonMarkdownPath(cwd, manifest.id)}`
      : "Comparison report: not available yet",
  );

  if (finalists.length === 0) {
    lines.push("No finalists yet. Candidate states:");
  } else {
    lines.push("Finalists:");
    for (const candidate of finalists) {
      lines.push(`- ${candidate.id}: ${candidate.strategyLabel}`);
    }
    lines.push("All candidates:");
  }

  for (const candidate of manifest.candidates) {
    lines.push(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})`);
  }

  return `${lines.join("\n")}\n`;
}
