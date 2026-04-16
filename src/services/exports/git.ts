import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import type { ManagedTreeRules } from "../../domain/config.js";
import type { CandidateManifest, ExportPlan } from "../../domain/run.js";
import { getExportMaterializationPatchPath } from "../../domain/run.js";
import { shouldManageProjectPath } from "../managed-tree.js";
import { RunStore } from "../run-store.js";
import {
  compareRelativePathsForRemoval,
  formatUnknownError,
  listParentDirectories,
  removeDirectoryIfEmpty,
} from "./shared.js";
import type { MaterializationOutcome } from "./types.js";

export async function materializeGitBranchExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
  managedTreeRules: ManagedTreeRules,
): Promise<MaterializationOutcome> {
  const store = new RunStore(projectRoot);
  const branchName = requireGitBranchName(plan);
  const patchPath =
    getExportMaterializationPatchPath(plan) ?? store.getRunPaths(plan.runId).exportPatchPath;
  await ensureCleanGitWorkingTree(projectRoot);
  await ensureBranchDoesNotExist(projectRoot, branchName);

  if (!winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the git revision needed for branch materialization.`,
    );
  }

  const currentBranch = await getCurrentGitBranch(projectRoot);
  const currentRevision = await getCurrentGitRevision(projectRoot);
  const initialUntrackedPaths = await listGitUntrackedPaths(projectRoot);
  const initialDirectoryPaths = await listProjectDirectoryPaths(projectRoot);
  if (currentRevision !== winner.baseRevision) {
    throw new OraculumError(
      `Cannot materialize candidate "${winner.id}" onto a branch because the current HEAD (${currentRevision}) no longer matches its recorded base revision (${winner.baseRevision}).`,
    );
  }

  const patch = await generateWorkspacePatch(
    projectRoot,
    winner.workspaceDir,
    winner.baseRevision,
    managedTreeRules,
  );
  if (!patch.trim()) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not have materialized branch changes to apply from ${winner.workspaceDir}.`,
    );
  }

  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(patchPath, patch, "utf8");

  const checkout = await runSubprocess({
    command: "git",
    args: ["checkout", "-b", branchName],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (checkout.exitCode !== 0) {
    throw new OraculumError(`Failed to create target branch "${branchName}" for crowning.`);
  }

  const apply = await runSubprocess({
    command: "git",
    args: ["apply", "--binary", patchPath],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (apply.exitCode !== 0) {
    try {
      await rollbackFailedBranchExport(
        projectRoot,
        branchName,
        currentBranch,
        currentRevision,
        initialUntrackedPaths,
        initialDirectoryPaths,
      );
    } catch (rollbackError) {
      throw new OraculumError(
        `Failed to materialize candidate "${winner.id}" onto branch "${branchName}", and rollback did not complete cleanly: ${formatUnknownError(rollbackError)}`,
      );
    }

    throw new OraculumError(
      `Failed to materialize candidate "${winner.id}" onto branch "${branchName}".`,
    );
  }

  return {
    async cleanup() {},
    partialPlan: {
      patchPath,
    },
    async rollback() {
      await rollbackFailedBranchExport(
        projectRoot,
        branchName,
        currentBranch,
        currentRevision,
        initialUntrackedPaths,
        initialDirectoryPaths,
      );
    },
  };
}

function requireGitBranchName(plan: ExportPlan): string {
  if (!plan.branchName) {
    throw new OraculumError(
      `Branch materialization for consultation "${plan.runId}" requires a target branch name.`,
    );
  }

  return plan.branchName;
}

async function ensureCleanGitWorkingTree(projectRoot: string): Promise<void> {
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

async function ensureBranchDoesNotExist(projectRoot: string, branchName: string): Promise<void> {
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

async function getCurrentGitBranch(projectRoot: string): Promise<string | undefined> {
  const branch = await runSubprocess({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  return branch.exitCode === 0 && branch.stdout.trim() ? branch.stdout.trim() : undefined;
}

async function getCurrentGitRevision(projectRoot: string): Promise<string> {
  const revision = await runSubprocess({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (revision.exitCode !== 0 || !revision.stdout.trim()) {
    throw new OraculumError(`Failed to read HEAD revision in ${projectRoot}.`);
  }

  return revision.stdout.trim();
}

async function generateWorkspacePatch(
  projectRoot: string,
  workspaceDir: string,
  baseRevision: string,
  managedTreeRules: ManagedTreeRules,
): Promise<string> {
  const stage = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "add", "-A"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (stage.exitCode !== 0) {
    throw new OraculumError(`Failed to stage candidate workspace at ${workspaceDir}.`);
  }

  const changedPathsResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "diff", "--cached", "--name-status", baseRevision, "--"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  const untrackedResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "ls-files", "--others", "--exclude-standard"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (changedPathsResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
    throw new OraculumError(`Failed to inspect branch materialization paths from ${workspaceDir}.`);
  }

  const changedPaths = new Set<string>();
  for (const line of changedPathsResult.stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const status = parts[0]?.trim() ?? "";
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const renameOrCopyPaths = status.startsWith("R")
        ? [parts[1]?.trim(), parts[2]?.trim()]
        : [parts[2]?.trim()];
      for (const candidatePath of renameOrCopyPaths) {
        if (candidatePath && shouldManageProjectPath(candidatePath, managedTreeRules)) {
          changedPaths.add(candidatePath);
        }
      }
      continue;
    }

    const candidatePath = parts[1]?.trim();
    if (candidatePath && shouldManageProjectPath(candidatePath, managedTreeRules)) {
      changedPaths.add(candidatePath);
    }
  }
  for (const line of untrackedResult.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed && shouldManageProjectPath(trimmed, managedTreeRules)) {
      changedPaths.add(trimmed);
    }
  }

  if (changedPaths.size === 0) {
    return "";
  }

  const diff = await runSubprocess({
    command: "git",
    args: [
      "-C",
      workspaceDir,
      "diff",
      "--cached",
      "--binary",
      baseRevision,
      "--",
      ...[...changedPaths].sort((left, right) => left.localeCompare(right)),
    ],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (diff.exitCode !== 0) {
    throw new OraculumError(
      `Failed to generate branch materialization changes from ${workspaceDir}.`,
    );
  }

  return diff.stdout;
}

async function rollbackFailedBranchExport(
  projectRoot: string,
  branchName: string,
  previousBranch: string | undefined,
  previousRevision: string,
  initialUntrackedPaths: string[],
  initialDirectoryPaths: Set<string>,
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
    await removeNewGitUntrackedPaths(projectRoot, initialUntrackedPaths, initialDirectoryPaths);
  } catch (error) {
    failures.push(`remove new untracked paths (${formatUnknownError(error)})`);
  }

  const restore = await restoreGitPosition(projectRoot, previousBranch, previousRevision);
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

async function listGitUntrackedPaths(projectRoot: string): Promise<string[]> {
  const result = await runSubprocess({
    command: "git",
    args: ["ls-files", "--others", "--exclude-standard"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new OraculumError(`Failed to list untracked files in ${projectRoot}.`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function removeNewGitUntrackedPaths(
  projectRoot: string,
  initialUntrackedPaths: string[],
  initialDirectoryPaths: Set<string>,
): Promise<void> {
  const initial = new Set(initialUntrackedPaths);
  const current = await listGitUntrackedPaths(projectRoot);
  const addedPaths = current.filter((relativePath) => !initial.has(relativePath));
  const candidateDirectories = new Set<string>();

  for (const relativePath of addedPaths.sort(compareRelativePathsForRemoval)) {
    await rm(join(projectRoot, relativePath), { recursive: true, force: true });
    for (const directory of listParentDirectories(relativePath)) {
      if (!initialDirectoryPaths.has(directory)) {
        candidateDirectories.add(directory);
      }
    }
  }

  for (const directory of [...candidateDirectories].sort(compareRelativePathsForRemoval)) {
    await removeDirectoryIfEmpty(join(projectRoot, directory));
  }
}

async function listProjectDirectoryPaths(
  projectRoot: string,
  relativeDir = "",
  seen = new Set<string>(),
): Promise<Set<string>> {
  const directoryPath = relativeDir ? join(projectRoot, relativeDir) : projectRoot;
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    if (!entry.isDirectory()) {
      continue;
    }

    seen.add(relativePath);
    await listProjectDirectoryPaths(projectRoot, relativePath, seen);
  }

  return seen;
}
