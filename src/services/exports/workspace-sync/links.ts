import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";

import { OraculumError } from "../../../core/errors.js";
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
  assertMaterializableSymlinkTarget({
    destinationPath,
    destinationRoot,
    entryPath: entry.path,
    replicatedTarget,
    sourcePath,
    sourceRoot,
    target: sourceTarget,
  });

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

function assertMaterializableSymlinkTarget(options: {
  destinationPath: string;
  destinationRoot: string;
  entryPath: string;
  replicatedTarget: string;
  sourcePath: string;
  sourceRoot: string;
  target: string;
}): void {
  const sourceTargetPath = resolveSymlinkTargetPath(dirname(options.sourcePath), options.target);
  if (!isPathInsideRoot(options.sourceRoot, sourceTargetPath)) {
    throw new OraculumError(
      `Refusing to materialize symlink "${options.entryPath}" because its target escapes the winner workspace.`,
    );
  }

  const destinationTargetPath = resolveSymlinkTargetPath(
    dirname(options.destinationPath),
    options.replicatedTarget,
  );
  if (!isPathInsideRoot(options.destinationRoot, destinationTargetPath)) {
    throw new OraculumError(
      `Refusing to materialize symlink "${options.entryPath}" because its target would escape the project root.`,
    );
  }
}

function resolveSymlinkTargetPath(anchorDir: string, target: string): string {
  return isPortableAbsolutePath(target) ? target : resolve(anchorDir, target);
}

function isPathInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !isPortableAbsolutePath(relativePath))
  );
}

function isPortableAbsolutePath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path);
}
