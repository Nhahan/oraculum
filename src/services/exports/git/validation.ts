import { OraculumError } from "../../../core/errors.js";
import { runSubprocess } from "../../../core/subprocess.js";
import type { ExportPlan } from "../../../domain/run.js";

export function requireGitBranchName(plan: ExportPlan): string {
  if (!plan.branchName) {
    throw new OraculumError(
      `Branch materialization for consultation "${plan.runId}" requires a target branch name.`,
    );
  }

  return plan.branchName;
}

export async function ensureCleanGitWorkingTree(projectRoot: string): Promise<void> {
  const unstaged = await runSubprocess({
    command: "git",
    args: ["diff", "--no-ext-diff", "--quiet", "--exit-code"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  const staged = await runSubprocess({
    command: "git",
    args: ["diff", "--cached", "--no-ext-diff", "--quiet", "--exit-code"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });

  const commandFailed = [unstaged.exitCode, staged.exitCode].some((code) => code > 1);
  if (commandFailed) {
    throw new OraculumError(`Failed to inspect git working tree in ${projectRoot}.`);
  }

  const hasTrackedChanges = unstaged.exitCode === 1 || staged.exitCode === 1;
  if (hasTrackedChanges) {
    throw new OraculumError(
      "Cannot materialize onto a git branch while the current working tree has tracked local changes.",
    );
  }
}

export async function ensureBranchDoesNotExist(
  projectRoot: string,
  branchName: string,
): Promise<void> {
  const existing = await runSubprocess({
    command: "git",
    args: ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (existing.exitCode === 0) {
    throw new OraculumError(`Branch "${branchName}" already exists.`);
  }
  if (existing.exitCode > 1) {
    throw new OraculumError(`Failed to inspect whether branch "${branchName}" already exists.`);
  }
}
