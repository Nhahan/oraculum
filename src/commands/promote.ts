import type { Command } from "commander";

import { materializeExport } from "../services/exports.js";

interface PromoteOptions {
  branch: string;
  consultation?: string;
  withReport?: boolean;
}

export function registerPromoteCommand(program: Command): void {
  program
    .command("promote")
    .description("Promote the recommended or selected candidate into the project.")
    .argument(
      "[candidate-id]",
      "promoted candidate to materialize; defaults to the recommended promotion",
    )
    .option("-b, --branch <branchName>", "branch name to create")
    .option(
      "--consultation <runId>",
      "consultation identifier; defaults to the latest exportable consultation",
    )
    .option("--with-report", "include report packaging metadata", false)
    .action(async (winner: string | undefined, options: PromoteOptions) => {
      await materializePromotion(winner, options);
    });
}

async function materializePromotion(
  winner: string | undefined,
  options: PromoteOptions,
): Promise<void> {
  if (!options.branch) {
    throw new Error("branch name is required. Use --branch <name>.");
  }

  const result = await materializeExport({
    cwd: process.cwd(),
    ...(options.consultation ? { runId: options.consultation } : {}),
    ...(winner ? { winnerId: winner } : {}),
    branchName: options.branch,
    withReport: options.withReport ?? false,
  });

  process.stdout.write(`Promoted ${result.plan.winnerId}\n`);
  process.stdout.write(`Consultation: ${result.plan.runId}\n`);
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
}
