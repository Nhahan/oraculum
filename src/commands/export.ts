import type { Command } from "commander";

import { materializeExport } from "../services/exports.js";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Materialize the recommended or selected candidate into a real export.")
    .argument("[candidate-id]", "promoted candidate to export; defaults to the recommended winner")
    .option("-r, --run <runId>", "run identifier; defaults to the latest run")
    .option("-b, --branch <branchName>", "branch name to create")
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
        const result = await materializeExport({
          cwd: process.cwd(),
          ...(options.run ? { runId: options.run } : {}),
          ...(winner ? { winnerId: winner } : {}),
          branchName,
          withReport: options.withReport ?? false,
        });

        process.stdout.write(`Exported ${result.plan.winnerId}\n`);
        process.stdout.write(`Run: ${result.plan.runId}\n`);
        process.stdout.write(`Mode: ${result.plan.mode}\n`);
        process.stdout.write(`Branch: ${result.plan.branchName}\n`);
        process.stdout.write(`Workspace: ${result.plan.workspaceDir}\n`);
        if (result.plan.patchPath) {
          process.stdout.write(`Patch: ${result.plan.patchPath}\n`);
        }
        if (result.plan.appliedPathCount !== undefined) {
          process.stdout.write(`Applied files: ${result.plan.appliedPathCount}\n`);
        }
        if (result.plan.removedPathCount !== undefined) {
          process.stdout.write(`Removed files: ${result.plan.removedPathCount}\n`);
        }
        process.stdout.write(`Report bundle: ${result.plan.withReport ? "yes" : "no"}\n`);
        if (result.plan.reportBundle) {
          process.stdout.write(`Reports: ${result.plan.reportBundle.files.length}\n`);
          process.stdout.write(`Report root: ${result.plan.reportBundle.rootDir}\n`);
        }
        process.stdout.write(`Record: ${result.path}\n`);
      },
    );
}
