import { type lstat, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { OraculumError } from "../../../core/errors.js";
import type { ManagedTreeRules } from "../../../domain/config.js";

import { listManagedProjectEntries, type ManagedPathEntry } from "../../managed-tree.js";
import { pathExists } from "../../project.js";

import { compareManagedEntriesForRemoval, isNotEmptyDirectoryError } from "../shared.js";

export async function removeManagedPath(
  projectRoot: string,
  entry: ManagedPathEntry,
): Promise<boolean> {
  const absolutePath = join(projectRoot, entry.path);
  if (!(await pathExists(absolutePath))) {
    return false;
  }

  if (entry.kind !== "dir") {
    await rm(absolutePath, { force: true, recursive: true });
    return true;
  }

  return removeManagedDirectoryIfEmpty(absolutePath);
}

export async function removeManagedDirectoryForReplacement(
  projectRoot: string,
  relativePath: string,
  destinationStats: Awaited<ReturnType<typeof lstat>>,
  managedTreeRules: ManagedTreeRules,
): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  if (!destinationStats.isDirectory()) {
    await rm(absolutePath, { recursive: true, force: true });
    return;
  }

  const nestedManagedEntries = await listManagedProjectEntries(projectRoot, {
    relativeDir: relativePath,
    rules: managedTreeRules,
  });
  for (const entry of [...nestedManagedEntries].sort(compareManagedEntriesForRemoval)) {
    await removeManagedPath(projectRoot, entry);
  }

  const removed = await removeManagedDirectoryIfEmpty(absolutePath);
  if (!removed) {
    throw new OraculumError(
      `Cannot replace managed directory "${relativePath}" because it still contains unmanaged files or directories.`,
    );
  }
}

async function removeManagedDirectoryIfEmpty(absolutePath: string): Promise<boolean> {
  try {
    await rmdir(absolutePath);
    return true;
  } catch (error) {
    if (isNotEmptyDirectoryError(error)) {
      return false;
    }

    throw error;
  }
}
