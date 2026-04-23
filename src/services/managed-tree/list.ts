import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { normalizeManagedTreeOptions, shouldManageProjectPath } from "./rules.js";
import type { ManagedPathEntry, ManagedTreeOptions } from "./types.js";

export async function listManagedProjectEntries(
  root: string,
  options: ManagedTreeOptions | string = {},
): Promise<ManagedPathEntry[]> {
  const normalizedOptions = normalizeManagedTreeOptions(options);
  const { rules } = normalizedOptions;
  const relativeDir = normalizedOptions.relativeDir ?? "";
  const directory = relativeDir ? join(root, relativeDir) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const managedEntries: ManagedPathEntry[] = [];

  for (const entry of entries) {
    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    if (!shouldManageProjectPath(relativePath, rules)) {
      continue;
    }

    if (entry.isDirectory()) {
      managedEntries.push({
        kind: "dir",
        path: relativePath,
      });
      managedEntries.push(
        ...(await listManagedProjectEntries(root, {
          relativeDir: relativePath,
          ...(rules ? { rules } : {}),
        })),
      );
      continue;
    }

    if (entry.isFile()) {
      managedEntries.push({
        kind: "file",
        path: relativePath,
      });
      continue;
    }

    if (entry.isSymbolicLink()) {
      managedEntries.push({
        kind: "symlink",
        path: relativePath,
      });
    }
  }

  return managedEntries.sort(compareManagedEntriesForApply);
}

function compareManagedEntriesForApply(left: ManagedPathEntry, right: ManagedPathEntry): number {
  const depthDelta = getPathDepth(left.path) - getPathDepth(right.path);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return left.path.localeCompare(right.path);
}

function getPathDepth(relativePath: string): number {
  return relativePath.split(/[\\/]+/u).length;
}
