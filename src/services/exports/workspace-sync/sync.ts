import { chmod, cp, lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ManagedTreeRules } from "../../../domain/config.js";

import { fileContentsEqual } from "../../file-content.js";
import { listManagedProjectEntries, type ManagedPathEntry } from "../../managed-tree.js";
import { pathExists } from "../../project.js";

import { compareManagedEntriesForRemoval, getManagedMode } from "../shared.js";
import type { WorkspaceSyncSummary } from "../types.js";

import { syncManagedSymlink } from "./links.js";
import { removeManagedDirectoryForReplacement, removeManagedPath } from "./removal.js";

export async function syncWorkspaceIntoProject(
  projectRoot: string,
  workspaceDir: string,
  managedTreeRules: ManagedTreeRules,
): Promise<WorkspaceSyncSummary> {
  const workspaceEntries = await listManagedProjectEntries(workspaceDir, {
    rules: managedTreeRules,
  });
  const projectEntries = await listManagedProjectEntries(projectRoot, {
    rules: managedTreeRules,
  });
  const workspaceSet = new Set(workspaceEntries.map((entry) => entry.path));
  const appliedFiles: string[] = [];

  for (const entry of workspaceEntries) {
    const changed = await syncManagedPath(workspaceDir, projectRoot, entry, managedTreeRules);
    if (changed) {
      appliedFiles.push(entry.path);
    }
  }

  const removedFiles: string[] = [];
  for (const entry of [...projectEntries].sort(compareManagedEntriesForRemoval)) {
    if (workspaceSet.has(entry.path)) {
      continue;
    }

    const removed = await removeManagedPath(projectRoot, entry);
    if (removed) {
      removedFiles.push(entry.path);
    }
  }

  return {
    appliedFiles,
    removedFiles,
  };
}

async function syncManagedPath(
  sourceRoot: string,
  destinationRoot: string,
  entry: ManagedPathEntry,
  managedTreeRules: ManagedTreeRules,
): Promise<boolean> {
  const sourcePath = join(sourceRoot, entry.path);
  const destinationPath = join(destinationRoot, entry.path);

  if (entry.kind === "dir") {
    return syncManagedDirectory(sourcePath, destinationPath);
  }

  if (entry.kind === "symlink") {
    return syncManagedSymlink(sourceRoot, sourcePath, destinationRoot, entry, managedTreeRules);
  }

  const destinationExists = await pathExists(destinationPath);
  const sourceStats = await lstat(sourcePath);
  const destinationMatches =
    destinationExists &&
    getManagedMode(sourceStats.mode) === getManagedMode((await lstat(destinationPath)).mode) &&
    (await fileContentsEqual(sourcePath, destinationPath));
  if (destinationMatches) {
    return false;
  }

  if (destinationExists) {
    const destinationStats = await lstat(destinationPath);
    if (!destinationStats.isFile()) {
      await removeManagedDirectoryForReplacement(
        destinationRoot,
        entry.path,
        destinationStats,
        managedTreeRules,
      );
    }
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true, recursive: false });
  await chmod(destinationPath, getManagedMode(sourceStats.mode));
  return true;
}

async function syncManagedDirectory(sourcePath: string, destinationPath: string): Promise<boolean> {
  const sourceStats = await lstat(sourcePath);
  if (!(await pathExists(destinationPath))) {
    await mkdir(destinationPath, { recursive: true });
    await chmod(destinationPath, getManagedMode(sourceStats.mode));
    return true;
  }

  const destinationStats = await lstat(destinationPath);
  if (
    destinationStats.isDirectory() &&
    getManagedMode(destinationStats.mode) === getManagedMode(sourceStats.mode)
  ) {
    return false;
  }

  if (!destinationStats.isDirectory()) {
    await rm(destinationPath, { recursive: true, force: true });
    await mkdir(destinationPath, { recursive: true });
  }

  await chmod(destinationPath, getManagedMode(sourceStats.mode));
  return true;
}
