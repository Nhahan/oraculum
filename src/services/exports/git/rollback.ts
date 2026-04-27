import { rm } from "node:fs/promises";
import { join } from "node:path";

import { OraculumError } from "../../../core/errors.js";
import { runSubprocess } from "../../../core/subprocess.js";
import {
  compareRelativePathsForRemoval,
  formatUnknownError,
  listParentDirectories,
  removeDirectoryIfEmpty,
} from "../shared.js";
import { type GitExportStateSnapshot, listGitUntrackedPaths } from "./state.js";

export async function rollbackFailedGitApplyExport(
  projectRoot: string,
  previousState: GitExportStateSnapshot,
): Promise<void> {
  const failures: string[] = [];

  const reset = await runSubprocess({
    command: "git",
    args: ["reset", "--hard", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (reset.exitCode !== 0) {
    failures.push("git reset --hard HEAD");
  }

  try {
    await removeNewGitUntrackedPaths(projectRoot, previousState);
  } catch (error) {
    failures.push(`remove new untracked paths (${formatUnknownError(error)})`);
  }

  const restore = await restoreGitPosition(
    projectRoot,
    previousState.currentBranch,
    previousState.currentRevision,
  );
  if (restore.exitCode !== 0) {
    failures.push(`git ${restore.args.join(" ")}`);
  }

  if (failures.length > 0) {
    throw new OraculumError(`Rollback failed during: ${failures.join(", ")}.`);
  }
}

export async function rollbackFailedGitBranchExport(
  projectRoot: string,
  branchName: string,
  previousState: GitExportStateSnapshot,
): Promise<void> {
  const failures: string[] = [];

  const reset = await runSubprocess({
    command: "git",
    args: ["reset", "--hard", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (reset.exitCode !== 0) {
    failures.push("git reset --hard HEAD");
  }

  try {
    await removeNewGitUntrackedPaths(projectRoot, previousState);
  } catch (error) {
    failures.push(`remove new untracked paths (${formatUnknownError(error)})`);
  }

  const restore = await restoreGitPosition(
    projectRoot,
    previousState.currentBranch,
    previousState.currentRevision,
  );
  if (restore.exitCode !== 0) {
    failures.push(`git ${restore.args.join(" ")}`);
  }

  const deleteBranch = await runSubprocess({
    command: "git",
    args: ["branch", "-D", branchName],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (deleteBranch.exitCode !== 0) {
    failures.push(`git branch -D ${branchName}`);
  }

  if (failures.length > 0) {
    throw new OraculumError(`Rollback failed during: ${failures.join(", ")}.`);
  }
}

async function restoreGitPosition(
  projectRoot: string,
  previousBranch: string | undefined,
  previousRevision: string,
): Promise<{ args: string[]; exitCode: number }> {
  const args = previousBranch
    ? ["checkout", previousBranch]
    : ["checkout", "--detach", previousRevision];
  const result = await runSubprocess({
    command: "git",
    args,
    cwd: projectRoot,
    timeoutMs: 30_000,
  });

  return {
    args,
    exitCode: result.exitCode,
  };
}

async function removeNewGitUntrackedPaths(
  projectRoot: string,
  previousState: GitExportStateSnapshot,
): Promise<void> {
  const initial = new Set(previousState.initialUntrackedPaths);
  const current = await listGitUntrackedPaths(projectRoot);
  const addedPaths = current.filter((relativePath) => !initial.has(relativePath));
  const candidateDirectories = new Set<string>();

  for (const relativePath of addedPaths.sort(compareRelativePathsForRemoval)) {
    await rm(join(projectRoot, relativePath), { recursive: true, force: true });
    for (const directory of listParentDirectories(relativePath)) {
      if (!previousState.initialDirectoryPaths.has(directory)) {
        candidateDirectories.add(directory);
      }
    }
  }

  for (const directory of [...candidateDirectories].sort(compareRelativePathsForRemoval)) {
    await removeDirectoryIfEmpty(join(projectRoot, directory));
  }
}
