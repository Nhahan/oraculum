import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { OraculumError } from "../core/errors.js";
import { runSubprocess } from "../core/subprocess.js";
import type { WorkspaceMode } from "../domain/run.js";

import { copyManagedProjectTree } from "./managed-tree.js";
import { pathExists } from "./project.js";

interface PrepareWorkspaceOptions {
  baseRevision?: string;
  projectRoot: string;
  workspaceDir: string;
}

export interface WorkspacePreparation {
  mode: WorkspaceMode;
  workspaceDir: string;
}

export async function prepareCandidateWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<WorkspacePreparation> {
  if ((await detectWorkspaceMode(options.projectRoot)) === "git-worktree") {
    return prepareGitWorktreeWorkspace(options);
  }

  return prepareCopiedWorkspace(options);
}

export async function detectWorkspaceMode(projectRoot: string): Promise<WorkspaceMode> {
  return (await isGitRepository(projectRoot)) ? "git-worktree" : "copy";
}

async function prepareGitWorktreeWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<WorkspacePreparation> {
  if (await pathExists(join(options.workspaceDir, ".git"))) {
    await resetGitWorktreeWorkspace(
      options.workspaceDir,
      options.projectRoot,
      options.baseRevision ?? "HEAD",
    );
    return {
      mode: "git-worktree",
      workspaceDir: options.workspaceDir,
    };
  }

  await rm(options.workspaceDir, { recursive: true, force: true });
  await mkdir(dirname(options.workspaceDir), { recursive: true });

  const worktreeAdd = await runSubprocess({
    command: "git",
    args: ["worktree", "add", "--detach", options.workspaceDir, options.baseRevision ?? "HEAD"],
    cwd: options.projectRoot,
    timeoutMs: 60_000,
  });
  if (worktreeAdd.exitCode !== 0) {
    await rm(options.workspaceDir, { recursive: true, force: true });
    throw new OraculumError(`Failed to create git worktree at ${options.workspaceDir}.`);
  }

  const verification = await runSubprocess({
    command: "git",
    args: ["-C", options.workspaceDir, "rev-parse", "--is-inside-work-tree"],
    cwd: options.projectRoot,
    timeoutMs: 15_000,
  });
  if (verification.exitCode !== 0) {
    throw new OraculumError(`Failed to prepare git worktree at ${options.workspaceDir}.`);
  }

  return {
    mode: "git-worktree",
    workspaceDir: options.workspaceDir,
  };
}

async function resetGitWorktreeWorkspace(
  workspaceDir: string,
  projectRoot: string,
  baseRevision: string,
): Promise<void> {
  const reset = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "reset", "--hard", baseRevision],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  const clean = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "clean", "-fdx"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });

  if (reset.exitCode !== 0 || clean.exitCode !== 0) {
    throw new OraculumError(`Failed to reset git worktree at ${workspaceDir}.`);
  }
}

async function prepareCopiedWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<WorkspacePreparation> {
  await rm(options.workspaceDir, { recursive: true, force: true });
  await mkdir(options.workspaceDir, { recursive: true });
  await copyManagedProjectTree(options.projectRoot, options.workspaceDir);

  return {
    mode: "copy",
    workspaceDir: options.workspaceDir,
  };
}

async function isGitRepository(projectRoot: string): Promise<boolean> {
  const result = await runSubprocess({
    command: "git",
    args: ["rev-parse", "--show-toplevel"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });

  return result.exitCode === 0 && result.stdout.trim().length > 0;
}
