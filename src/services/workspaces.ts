import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { OraculumError } from "../core/errors.js";
import { runSubprocess } from "../core/subprocess.js";
import type { WorkspaceMode } from "../domain/run.js";

interface PrepareWorkspaceOptions {
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
  if (await isGitRepository(options.projectRoot)) {
    return prepareGitWorktreeWorkspace(options);
  }

  return prepareCopiedWorkspace(options);
}

async function prepareGitWorktreeWorkspace(
  options: PrepareWorkspaceOptions,
): Promise<WorkspacePreparation> {
  if (await pathExists(join(options.workspaceDir, ".git"))) {
    await resetGitWorktreeWorkspace(options.workspaceDir, options.projectRoot);
    return {
      mode: "git-worktree",
      workspaceDir: options.workspaceDir,
    };
  }

  await rm(options.workspaceDir, { recursive: true, force: true });
  await mkdir(dirname(options.workspaceDir), { recursive: true });

  await runSubprocess({
    command: "git",
    args: ["worktree", "add", "--detach", options.workspaceDir, "HEAD"],
    cwd: options.projectRoot,
    timeoutMs: 60_000,
  });

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

async function resetGitWorktreeWorkspace(workspaceDir: string, projectRoot: string): Promise<void> {
  const reset = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "reset", "--hard", "HEAD"],
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

  const entries = await readdir(options.projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldCopyEntry(entry.name)) {
      continue;
    }

    const sourcePath = join(options.projectRoot, entry.name);
    const destinationPath = join(options.workspaceDir, entry.name);
    await cp(sourcePath, destinationPath, { recursive: true });
  }

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

function shouldCopyEntry(name: string): boolean {
  const base = basename(name);
  if ([".git", ".oraculum", "dist", "node_modules"].includes(base)) {
    return false;
  }

  if (
    [
      ".aws",
      ".env",
      ".env.local",
      ".env.development",
      ".env.production",
      ".env.test",
      ".gnupg",
      ".kube",
      ".netrc",
      ".npmrc",
      ".pypirc",
      ".ssh",
    ].includes(base)
  ) {
    return false;
  }

  if (base.startsWith(".env.")) {
    return false;
  }

  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
