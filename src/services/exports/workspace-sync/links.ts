import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ManagedTreeRules } from "../../../domain/config.js";

import {
  type ManagedPathEntry,
  normalizeManagedSymlinkTarget,
  readSymlinkTargetType as readManagedSymlinkTargetType,
} from "../../managed-tree.js";
import { pathExists } from "../../project.js";

import { removeManagedDirectoryForReplacement } from "./removal.js";

export async function syncManagedSymlink(
  sourceRoot: string,
  sourcePath: string,
  destinationRoot: string,
  entry: ManagedPathEntry,
  managedTreeRules: ManagedTreeRules,
): Promise<boolean> {
  const destinationPath = join(destinationRoot, entry.path);
  const sourceTarget = await readlink(sourcePath);
  const sourceTargetType = await readSymlinkTargetType(sourcePath);
  const replicatedTarget = normalizeManagedSymlinkTarget({
    destinationPath,
    destinationRoot,
    sourcePath,
    sourceRoot,
    target: sourceTarget,
    targetType: sourceTargetType,
    rules: managedTreeRules,
  });

  if (await symlinkMatches(destinationPath, replicatedTarget, sourceTargetType)) {
    return false;
  }

  if (await pathExists(destinationPath)) {
    const destinationStats = await lstat(destinationPath);
    if (destinationStats.isDirectory()) {
      await removeManagedDirectoryForReplacement(
        destinationRoot,
        entry.path,
        destinationStats,
        managedTreeRules,
      );
    } else {
      await rm(destinationPath, { recursive: true, force: true });
    }
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  await symlink(replicatedTarget, destinationPath, sourceTargetType);
  return true;
}

async function symlinkMatches(
  destinationPath: string,
  expectedTarget: string,
  expectedType: "file" | "dir" | "junction" | undefined,
): Promise<boolean> {
  if (!(await pathExists(destinationPath))) {
    return false;
  }

  const destinationStats = await lstat(destinationPath);
  if (!destinationStats.isSymbolicLink()) {
    return false;
  }

  const [actualTarget, actualType] = await Promise.all([
    readlink(destinationPath),
    readSymlinkTargetType(destinationPath),
  ]);

  return actualTarget === expectedTarget && actualType === expectedType;
}

async function readSymlinkTargetType(
  path: string,
): Promise<"file" | "dir" | "junction" | undefined> {
  return readManagedSymlinkTargetType(path);
}
