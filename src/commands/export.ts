import type { Command } from "commander";

import { buildExportPlan } from "../services/runs.js";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Write an export plan for a selected candidate.")
    .requiredOption("-r, --run <runId>", "run identifier")
    .requiredOption("-w, --winner <candidateId>", "candidate to export")
    .requiredOption("-b, --as-branch <branchName>", "branch name to propose")
    .option("--with-report", "include report packaging metadata", false)
    .action(
      async (options: { asBranch: string; run: string; winner: string; withReport?: boolean }) => {
        const result = await buildExportPlan({
          cwd: process.cwd(),
          runId: options.run,
          winnerId: options.winner,
          branchName: options.asBranch,
          withReport: options.withReport ?? false,
        });

        process.stdout.write(`Prepared export plan for ${result.plan.winnerId}\n`);
        process.stdout.write(`Run: ${result.plan.runId}\n`);
        process.stdout.write(`Branch: ${result.plan.branchName}\n`);
        process.stdout.write(`Report bundle: ${result.plan.withReport ? "yes" : "no"}\n`);
        process.stdout.write(`Plan: ${result.path}\n`);
      },
    );
}
