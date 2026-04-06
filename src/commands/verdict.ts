import type { Command } from "commander";

import { readLatestRunManifest, readRunManifest } from "../services/runs.js";

export function registerVerdictCommand(program: Command): void {
  const verdict = program
    .command("verdict")
    .description("Reopen the latest verdict or inspect a specific consultation.")
    .argument("[run-id]", "consultation identifier; defaults to the latest consultation")
    .action(async (runId?: string) => {
      await writeVerdict(runId);
    });

  verdict
    .command("consultation")
    .description("Inspect a specific consultation by id.")
    .argument("<consultation-id>", "consultation identifier")
    .action(async (runId: string) => {
      await writeVerdict(runId);
    });
}

async function writeVerdict(runId?: string): Promise<void> {
  const manifest = runId
    ? await readRunManifest(process.cwd(), runId)
    : await readLatestRunManifest(process.cwd());
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );

  process.stdout.write(`Consultation: ${manifest.id}\n`);
  process.stdout.write(`Task: ${manifest.taskPacket.title}\n`);
  process.stdout.write(`Agent: ${manifest.agent}\n`);
  process.stdout.write(`Candidates: ${manifest.candidateCount}\n`);
  process.stdout.write(`Status: ${manifest.status}\n`);
  if (manifest.recommendedWinner) {
    process.stdout.write(
      `Recommended promotion: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})\n`,
    );
    process.stdout.write(`${manifest.recommendedWinner.summary}\n`);
  }
  process.stdout.write(`Comparison report: .oraculum/runs/${manifest.id}/reports/comparison.md\n`);

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
    process.stdout.write(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})\n`);
  }
}
