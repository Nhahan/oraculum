import type { Command } from "commander";

import { buildExportPlan } from "../services/runs.js";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Write an export plan for the recommended or selected candidate.")
    .argument("[candidate-id]", "promoted candidate to export; defaults to the recommended winner")
    .option("-r, --run <runId>", "run identifier; defaults to the latest run")
    .option("-b, --branch <branchName>", "branch name to propose")
    .option("--as-branch <branchName>", "legacy branch option")
    .option("--with-report", "include report packaging metadata", false)
    .action(
      async (
        winner: string | undefined,
        options: {
          asBranch?: string;
          branch?: string;
          run?: string;
          withReport?: boolean;
        },
      ) => {
        const branchName = options.branch ?? options.asBranch;
        if (!branchName) {
          throw new Error("branch name is required. Use --branch <name>.");
        }
        const result = await buildExportPlan({
          cwd: process.cwd(),
          ...(options.run ? { runId: options.run } : {}),
          ...(winner ? { winnerId: winner } : {}),
          branchName,
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
