import type { Command } from "commander";

import { readRunManifest } from "../services/runs.js";

export function registerFinalistsCommand(program: Command): void {
  program
    .command("finalists")
    .description("Inspect the currently promoted candidates for a run.")
    .argument("<run-id>", "run identifier")
    .action(async (runId: string) => {
      const manifest = await readRunManifest(process.cwd(), runId);
      const finalists = manifest.candidates.filter((candidate) => candidate.status === "promoted");

      process.stdout.write(`Run: ${manifest.id}\n`);
      if (finalists.length === 0) {
        process.stdout.write("No finalists yet. Current candidate states:\n");
        for (const candidate of manifest.candidates) {
          process.stdout.write(
            `- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})\n`,
          );
        }
        return;
      }

      process.stdout.write("Finalists:\n");
      for (const candidate of finalists) {
        process.stdout.write(`- ${candidate.id}: ${candidate.strategyLabel}\n`);
      }
    });
}
