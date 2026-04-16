import { chmod, cp, lstat, mkdir, mkdtemp, readlink, rm, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import type { ManagedTreeRules } from "../../domain/config.js";
import type { CandidateManifest, ExportPlan } from "../../domain/run.js";
import { assertManagedProjectSnapshotUnchanged } from "../base-snapshots.js";
import { fileContentsEqual } from "../file-content.js";
import {
  copyManagedProjectTree,
  listManagedProjectEntries,
  type ManagedPathEntry,
  normalizeManagedSymlinkTarget,
  readSymlinkTargetType as readManagedSymlinkTargetType,
} from "../managed-tree.js";
import { pathExists } from "../project.js";

import {
  compareManagedEntriesForRemoval,
  formatUnknownError,
  getManagedMode,
  isNotEmptyDirectoryError,
} from "./shared.js";
import type { MaterializationOutcome, WorkspaceSyncSummary } from "./types.js";

export async function materializeWorkspaceSyncExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
  managedTreeRules: ManagedTreeRules,
): Promise<MaterializationOutcome> {
  if (!winner.baseSnapshotPath) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the project snapshot it was generated from.`,
    );
  }

  await assertManagedProjectSnapshotUnchanged(projectRoot, winner.baseSnapshotPath, {
    rules: managedTreeRules,
  });
  const backupRoot = await createManagedProjectBackup(projectRoot, plan.runId, managedTreeRules);
  try {
    const summary = await syncWorkspaceIntoProject(
      projectRoot,
      winner.workspaceDir,
      managedTreeRules,
    );
    return {
      async cleanup() {
        await rm(backupRoot, { recursive: true, force: true });
      },
      partialPlan: {
        appliedPathCount: summary.appliedFiles.length,
        removedPathCount: summary.removedFiles.length,
      },
      async rollback() {
        const rollbackError = await restoreManagedProjectBackup(
          projectRoot,
          backupRoot,
          managedTreeRules,
        );
        if (rollbackError) {
          throw rollbackError;
        }
      },
      syncSummary: summary,
    };
  } catch (error) {
    try {
      const rollbackError = await restoreManagedProjectBackup(
        projectRoot,
        backupRoot,
        managedTreeRules,
      );
      if (rollbackError) {
        throw new OraculumError(
          `Workspace-sync materialization failed and rollback did not complete cleanly: ${formatUnknownError(error)}; rollback error: ${rollbackError.message}`,
        );
      }
    } finally {
      await rm(backupRoot, { recursive: true, force: true });
    }

    throw error;
  }
}

async function syncWorkspaceIntoProject(
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
    return syncManagedSymlink(
      sourceRoot,
      sourcePath,
      destinationRoot,
      entry.path,
      managedTreeRules,
    );
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

async function syncManagedSymlink(
  sourceRoot: string,
  sourcePath: string,
  destinationRoot: string,
  relativePath: string,
  managedTreeRules: ManagedTreeRules,
): Promise<boolean> {
  const destinationPath = join(destinationRoot, relativePath);
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
        relativePath,
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

async function createManagedProjectBackup(
  projectRoot: string,
  runId: string,
  managedTreeRules: ManagedTreeRules,
): Promise<string> {
  const backupRoot = await mkdtemp(join(tmpdir(), `oraculum-export-${runId}-`));
  try {
    await copyManagedProjectTree(projectRoot, backupRoot, { rules: managedTreeRules });
  } catch (error) {
    await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }

  return backupRoot;
}

async function restoreManagedProjectBackup(
  projectRoot: string,
  backupRoot: string,
  managedTreeRules: ManagedTreeRules,
): Promise<Error | undefined> {
  try {
    await syncWorkspaceIntoProject(projectRoot, backupRoot, managedTreeRules);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function removeManagedPath(projectRoot: string, entry: ManagedPathEntry): Promise<boolean> {
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

async function removeManagedDirectoryForReplacement(
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
