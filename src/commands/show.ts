import type { Command } from "commander";

import { readLatestRunManifest, readRunManifest } from "../services/runs.js";

export function registerShowCommand(program: Command): void {
  program
    .command("show")
    .alias("finalists")
    .description("Show the latest run summary or inspect a specific run.")
    .argument("[run-id]", "run identifier; defaults to the latest run")
    .action(async (runId?: string) => {
      const manifest = runId
        ? await readRunManifest(process.cwd(), runId)
        : await readLatestRunManifest(process.cwd());
      const finalists = manifest.candidates.filter((candidate) => candidate.status === "promoted");

      process.stdout.write(`Run: ${manifest.id}\n`);
      process.stdout.write(`Task: ${manifest.taskPacket.title}\n`);
      process.stdout.write(`Agent: ${manifest.agent}\n`);
      process.stdout.write(`Candidates: ${manifest.candidateCount}\n`);
      process.stdout.write(`Status: ${manifest.status}\n`);
      if (manifest.recommendedWinner) {
        process.stdout.write(
          `Recommended winner: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})\n`,
        );
        process.stdout.write(`${manifest.recommendedWinner.summary}\n`);
      }
      process.stdout.write(
        `Comparison report: .oraculum/runs/${manifest.id}/reports/comparison.md\n`,
      );

      if (finalists.length === 0) {
        process.stdout.write("No finalists yet. Candidate states:\n");
      } else {
        process.stdout.write("Finalists:\n");
        for (const candidate of finalists) {
          process.stdout.write(`- ${candidate.id}: ${candidate.strategyLabel}\n`);
        }
        process.stdout.write("All candidates:\n");
      }

      for (const candidate of manifest.candidates) {
        process.stdout.write(
          `- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})\n`,
        );
      }
    });
}
