import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { OraculumError } from "../../../core/errors.js";
import { runSubprocess } from "../../../core/subprocess.js";

export type GitExportStateSnapshot = {
  currentBranch: string | undefined;
  currentRevision: string;
  initialDirectoryPaths: Set<string>;
  initialUntrackedPaths: string[];
};

export async function captureGitExportState(projectRoot: string): Promise<GitExportStateSnapshot> {
  const [currentBranch, currentRevision, initialUntrackedPaths, initialDirectoryPaths] =
    await Promise.all([
      getCurrentGitBranch(projectRoot),
      getCurrentGitRevision(projectRoot),
      listGitUntrackedPaths(projectRoot),
      listProjectDirectoryPaths(projectRoot),
    ]);

  return {
    currentBranch,
    currentRevision,
    initialDirectoryPaths,
    initialUntrackedPaths,
  };
}

export async function listGitUntrackedPaths(projectRoot: string): Promise<string[]> {
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
