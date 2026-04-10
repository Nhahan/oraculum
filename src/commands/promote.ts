import type { Command } from "commander";

import { materializeExport } from "../services/exports.js";

interface CrownOptions {
  branch: string;
  consultation?: string;
  withReport?: boolean;
}

export function registerCrownCommand(program: Command): void {
  program
    .command("crown")
    .description("Crown the recommended or selected survivor and materialize it in the project.")
    .argument("[candidate-id]", "candidate to crown; defaults to the recommended survivor")
    .requiredOption("-b, --branch <branchName>", "branch name to create")
    .option(
      "--consultation <runId>",
      "consultation identifier; defaults to the latest consultation when a candidate id is given, otherwise the latest consultation with a recommended survivor",
    )
    .option("--with-report", "include report packaging metadata", false)
    .action(async (winner: string | undefined, options: CrownOptions) => {
      await materializeCrowning(winner, options);
    });
}

async function materializeCrowning(
  winner: string | undefined,
  options: CrownOptions,
): Promise<void> {
  const result = await materializeExport({
    cwd: process.cwd(),
    ...(options.consultation ? { runId: options.consultation } : {}),
    ...(winner ? { winnerId: winner } : {}),
    branchName: options.branch,
    withReport: options.withReport ?? false,
  });

  process.stdout.write(`Crowned ${result.plan.winnerId}\n`);
  process.stdout.write(`Consultation: ${result.plan.runId}\n`);
  process.stdout.write(`Mode: ${result.plan.mode}\n`);
  if (result.plan.mode === "git-branch" && result.plan.branchName) {
    process.stdout.write(`Branch: ${result.plan.branchName}\n`);
  }
  const materializationLabel =
    result.plan.mode === "workspace-sync"
      ? (result.plan.materializationLabel ?? result.plan.branchName)
      : undefined;
  if (materializationLabel) {
    process.stdout.write(`Label: ${materializationLabel}\n`);
  }
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
  process.stdout.write(`Crowning record: ${result.path}\n`);
}
