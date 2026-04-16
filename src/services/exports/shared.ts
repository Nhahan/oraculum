import { lstat, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ManagedPathEntry } from "../managed-tree.js";

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) {
      return undefined;
    }

    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function restoreOptionalTextFile(
  path: string,
  contents: string | undefined,
): Promise<void> {
  if (contents === undefined) {
    await rm(path, { force: true });
    return;
  }

  await mkdirParent(path);
  await writeFile(path, contents, "utf8");
}

export async function currentFileContentsMatch(path: string, expected: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) {
      return false;
    }

    return (await readFile(path, "utf8")) === expected;
  } catch {
    return false;
  }
}

export function compareManagedEntriesForRemoval(
  left: ManagedPathEntry,
  right: ManagedPathEntry,
): number {
  const depthDelta = getPathDepth(right.path) - getPathDepth(left.path);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return right.path.localeCompare(left.path);
}

export function compareRelativePathsForRemoval(left: string, right: string): number {
  const depthDelta = getPathDepth(right) - getPathDepth(left);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return right.localeCompare(left);
}

export function getManagedMode(mode: number): number {
  return mode & 0o777;
}

export function isNotEmptyDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
  );
}

export function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
  );
}

export async function removeDirectoryIfEmpty(absolutePath: string): Promise<void> {
  try {
    await rmdir(absolutePath);
  } catch (error) {
    if (isNotEmptyDirectoryError(error) || isMissingPathError(error)) {
      return;
    }

    throw error;
  }
}

export function listParentDirectories(relativePath: string): string[] {
  const parents: string[] = [];
  let current = dirname(relativePath);
  while (current && current !== "." && !parents.includes(current)) {
    parents.push(current);
    const next = dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }

  return parents;
}

function getPathDepth(relativePath: string): number {
  return relativePath.split(/[\\/]+/u).length;
}

async function mkdirParent(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
}
