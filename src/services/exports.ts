import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { OraculumError } from "../core/errors.js";
import {
  getCandidateManifestPath,
  getExportPatchPath,
  getExportSyncSummaryPath,
  getRunManifestPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { runSubprocess } from "../core/subprocess.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  type ExportPlan,
  exportPlanSchema,
  type RunManifest,
  runManifestSchema,
} from "../domain/run.js";

import { assertManagedProjectSnapshotUnchanged } from "./base-snapshots.js";
import {
  copyManagedProjectTree,
  listManagedProjectEntries,
  type ManagedPathEntry,
  normalizeManagedSymlinkTarget,
  readSymlinkTargetType as readManagedSymlinkTargetType,
  shouldManageProjectPath,
} from "./managed-tree.js";
import { pathExists, writeJsonFile } from "./project.js";
import { prepareExportPlan, readRunManifest } from "./runs.js";

interface MaterializeExportOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName: string;
  withReport: boolean;
}

interface WorkspaceSyncSummary {
  appliedFiles: string[];
  removedFiles: string[];
}

interface MaterializationOutcome {
  cleanup(): Promise<void>;
  partialPlan: Partial<ExportPlan>;
  rollback(): Promise<void>;
  syncSummary?: WorkspaceSyncSummary;
}

export async function materializeExport(
  options: MaterializeExportOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const { path, plan: planned } = await prepareExportPlan(options);
  const syncSummaryPath = getExportSyncSummaryPath(projectRoot, planned.runId);
  const manifest = await readRunManifest(projectRoot, planned.runId);
  const winner = findExportCandidate(manifest, planned.winnerId);
  const [previousPlanContents, previousSyncSummaryContents] = await Promise.all([
    readOptionalTextFile(path),
    readOptionalTextFile(syncSummaryPath),
  ]);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(dirname(syncSummaryPath), { recursive: true });

  const outcome =
    planned.mode === "git-branch"
      ? await materializeGitBranchExport(projectRoot, planned, winner)
      : await materializeWorkspaceSyncExport(projectRoot, planned, winner);

  const updatedPlan = exportPlanSchema.parse({
    ...planned,
    ...outcome.partialPlan,
  });

  try {
    if (outcome.syncSummary) {
      await writeJsonFile(syncSummaryPath, outcome.syncSummary);
    }

    await writeJsonFile(path, updatedPlan);
    await markCandidateExported(projectRoot, manifest, winner.id);
  } catch (error) {
    const cleanupFailures: string[] = [];

    try {
      await outcome.rollback();
    } catch (rollbackError) {
      throw new OraculumError(
        `Crowning bookkeeping failed after applying changes and rollback did not complete cleanly: ${formatUnknownError(error)}; rollback error: ${formatUnknownError(rollbackError)}`,
      );
    }

    try {
      await restoreOptionalTextFile(path, previousPlanContents);
    } catch (restoreError) {
      cleanupFailures.push(`crowning record (${formatUnknownError(restoreError)})`);
    }

    try {
      await restoreOptionalTextFile(syncSummaryPath, previousSyncSummaryContents);
    } catch (restoreError) {
      cleanupFailures.push(`workspace-sync summary (${formatUnknownError(restoreError)})`);
    }

    try {
      await outcome.cleanup();
    } catch (cleanupError) {
      cleanupFailures.push(`temporary cleanup (${formatUnknownError(cleanupError)})`);
    }

    if (cleanupFailures.length > 0) {
      throw new OraculumError(
        `Crowning bookkeeping failed after applying changes and the crowning was rolled back, but cleanup did not complete cleanly: ${cleanupFailures.join(", ")}.`,
      );
    }

    throw new OraculumError(
      `Crowning bookkeeping failed after applying changes and the crowning was rolled back: ${formatUnknownError(error)}`,
    );
  }

  await outcome.cleanup();

  return {
    plan: updatedPlan,
    path,
  };
}

function findExportCandidate(manifest: RunManifest, candidateId: string): CandidateManifest {
  const candidate = manifest.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new OraculumError(
      `Candidate "${candidateId}" does not exist in consultation "${manifest.id}".`,
    );
  }

  if (candidate.status !== "promoted" && candidate.status !== "exported") {
    throw new OraculumError(
      `Candidate "${candidate.id}" is not eligible for crowning because its status is "${candidate.status}".`,
    );
  }

  return candidate;
}

async function materializeGitBranchExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
): Promise<MaterializationOutcome> {
  const patchPath = plan.patchPath ?? getExportPatchPath(projectRoot, plan.runId);
  await ensureCleanGitWorkingTree(projectRoot);
  await ensureBranchDoesNotExist(projectRoot, plan.branchName);

  if (!winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the git revision it was generated from.`,
    );
  }

  const currentBranch = await getCurrentGitBranch(projectRoot);
  const currentRevision = await getCurrentGitRevision(projectRoot);
  const initialUntrackedPaths = await listGitUntrackedPaths(projectRoot);
  const initialDirectoryPaths = await listProjectDirectoryPaths(projectRoot);
  if (currentRevision !== winner.baseRevision) {
    throw new OraculumError(
      `Cannot crown candidate "${winner.id}" because the current HEAD (${currentRevision}) no longer matches its recorded base revision (${winner.baseRevision}).`,
    );
  }

  const patch = await generateWorkspacePatch(projectRoot, winner.workspaceDir, winner.baseRevision);
  if (!patch.trim()) {
    throw new OraculumError(
      `Candidate "${winner.id}" has no materialized patch to crown from ${winner.workspaceDir}.`,
    );
  }

  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(patchPath, patch, "utf8");

  const checkout = await runSubprocess({
    command: "git",
    args: ["checkout", "-b", plan.branchName],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (checkout.exitCode !== 0) {
    throw new OraculumError(`Failed to create target branch "${plan.branchName}" for crowning.`);
  }

  const apply = await runSubprocess({
    command: "git",
    args: ["apply", "--binary", patchPath],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (apply.exitCode !== 0) {
    try {
      await rollbackFailedBranchExport(
        projectRoot,
        plan.branchName,
        currentBranch,
        currentRevision,
        initialUntrackedPaths,
        initialDirectoryPaths,
      );
    } catch (rollbackError) {
      throw new OraculumError(
        `Failed to apply the crowned patch onto branch "${plan.branchName}", and rollback did not complete cleanly: ${formatUnknownError(rollbackError)}`,
      );
    }

    throw new OraculumError(`Failed to apply the crowned patch onto branch "${plan.branchName}".`);
  }

  return {
    async cleanup() {},
    partialPlan: {
      patchPath,
    },
    async rollback() {
      await rollbackFailedBranchExport(
        projectRoot,
        plan.branchName,
        currentBranch,
        currentRevision,
        initialUntrackedPaths,
        initialDirectoryPaths,
      );
    },
  };
}

async function materializeWorkspaceSyncExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
): Promise<MaterializationOutcome> {
  if (!winner.baseSnapshotPath) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the project snapshot it was generated from.`,
    );
  }

  await assertManagedProjectSnapshotUnchanged(projectRoot, winner.baseSnapshotPath);
  const backupRoot = await createManagedProjectBackup(projectRoot, plan.runId);
  try {
    const summary = await syncWorkspaceIntoProject(projectRoot, winner.workspaceDir);
    return {
      async cleanup() {
        await rm(backupRoot, { recursive: true, force: true });
      },
      partialPlan: {
        appliedPathCount: summary.appliedFiles.length,
        removedPathCount: summary.removedFiles.length,
      },
      async rollback() {
        const rollbackError = await restoreManagedProjectBackup(projectRoot, backupRoot);
        if (rollbackError) {
          throw rollbackError;
        }
      },
      syncSummary: summary,
    };
  } catch (error) {
    try {
      const rollbackError = await restoreManagedProjectBackup(projectRoot, backupRoot);
      if (rollbackError) {
        throw new OraculumError(
          `Workspace-sync crowning failed and rollback did not complete cleanly: ${formatUnknownError(error)}; rollback error: ${rollbackError.message}`,
        );
      }
    } finally {
      await rm(backupRoot, { recursive: true, force: true });
    }

    throw error;
  }
}

async function ensureCleanGitWorkingTree(projectRoot: string): Promise<void> {
  const unstaged = await runSubprocess({
    command: "git",
    args: ["diff", "--no-ext-diff", "--quiet", "--exit-code"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  const staged = await runSubprocess({
    command: "git",
    args: ["diff", "--cached", "--no-ext-diff", "--quiet", "--exit-code"],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });

  const commandFailed = [unstaged.exitCode, staged.exitCode].some((code) => code > 1);
  if (commandFailed) {
    throw new OraculumError(`Failed to inspect git working tree in ${projectRoot}.`);
  }

  const hasTrackedChanges = unstaged.exitCode === 1 || staged.exitCode === 1;
  if (hasTrackedChanges) {
    throw new OraculumError(
      "Cannot crown onto a git branch while the current working tree has tracked local changes.",
    );
  }
}

async function ensureBranchDoesNotExist(projectRoot: string, branchName: string): Promise<void> {
  const existing = await runSubprocess({
    command: "git",
    args: ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`],
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (existing.exitCode === 0) {
    throw new OraculumError(`Branch "${branchName}" already exists.`);
  }
  if (existing.exitCode > 1) {
    throw new OraculumError(`Failed to inspect whether branch "${branchName}" already exists.`);
  }
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

async function generateWorkspacePatch(
  projectRoot: string,
  workspaceDir: string,
  baseRevision: string,
): Promise<string> {
  const stage = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "add", "-A"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (stage.exitCode !== 0) {
    throw new OraculumError(`Failed to stage candidate workspace at ${workspaceDir}.`);
  }

  const changedPathsResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "diff", "--cached", "--name-status", baseRevision, "--"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  const untrackedResult = await runSubprocess({
    command: "git",
    args: ["-C", workspaceDir, "ls-files", "--others", "--exclude-standard"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (changedPathsResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
    throw new OraculumError(`Failed to inspect crowning patch paths from ${workspaceDir}.`);
  }

  const changedPaths = new Set<string>();
  for (const line of changedPathsResult.stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const status = parts[0]?.trim() ?? "";
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const renameOrCopyPaths = status.startsWith("R")
        ? [parts[1]?.trim(), parts[2]?.trim()]
        : [parts[2]?.trim()];
      for (const candidatePath of renameOrCopyPaths) {
        if (candidatePath && shouldManageProjectPath(candidatePath)) {
          changedPaths.add(candidatePath);
        }
      }
      continue;
    }

    const candidatePath = parts[1]?.trim();
    if (candidatePath && shouldManageProjectPath(candidatePath)) {
      changedPaths.add(candidatePath);
    }
  }
  for (const line of untrackedResult.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed && shouldManageProjectPath(trimmed)) {
      changedPaths.add(trimmed);
    }
  }

  if (changedPaths.size === 0) {
    return "";
  }

  const diff = await runSubprocess({
    command: "git",
    args: [
      "-C",
      workspaceDir,
      "diff",
      "--cached",
      "--binary",
      baseRevision,
      "--",
      ...[...changedPaths].sort((left, right) => left.localeCompare(right)),
    ],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (diff.exitCode !== 0) {
    throw new OraculumError(`Failed to generate crowning patch from ${workspaceDir}.`);
  }

  return diff.stdout;
}

async function rollbackFailedBranchExport(
  projectRoot: string,
  branchName: string,
  previousBranch: string | undefined,
  previousRevision: string,
  initialUntrackedPaths: string[],
  initialDirectoryPaths: Set<string>,
): Promise<void> {
  const failures: string[] = [];

  const reset = await runSubprocess({
    command: "git",
    args: ["reset", "--hard", "HEAD"],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (reset.exitCode !== 0) {
    failures.push("git reset --hard HEAD");
  }

  try {
    await removeNewGitUntrackedPaths(projectRoot, initialUntrackedPaths, initialDirectoryPaths);
  } catch (error) {
    failures.push(`remove new untracked paths (${formatUnknownError(error)})`);
  }

  const restore = await restoreGitPosition(projectRoot, previousBranch, previousRevision);
  if (restore.exitCode !== 0) {
    failures.push(`git ${restore.args.join(" ")}`);
  }

  const deleteBranch = await runSubprocess({
    command: "git",
    args: ["branch", "-D", branchName],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (deleteBranch.exitCode !== 0) {
    failures.push(`git branch -D ${branchName}`);
  }

  if (failures.length > 0) {
    throw new OraculumError(`Rollback failed during: ${failures.join(", ")}.`);
  }
}

async function restoreGitPosition(
  projectRoot: string,
  previousBranch: string | undefined,
  previousRevision: string,
): Promise<{ args: string[]; exitCode: number }> {
  const args = previousBranch
    ? ["checkout", previousBranch]
    : ["checkout", "--detach", previousRevision];
  const result = await runSubprocess({
    command: "git",
    args,
    cwd: projectRoot,
    timeoutMs: 30_000,
  });

  return {
    args,
    exitCode: result.exitCode,
  };
}

async function listGitUntrackedPaths(projectRoot: string): Promise<string[]> {
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

async function removeNewGitUntrackedPaths(
  projectRoot: string,
  initialUntrackedPaths: string[],
  initialDirectoryPaths: Set<string>,
): Promise<void> {
  const initial = new Set(initialUntrackedPaths);
  const current = await listGitUntrackedPaths(projectRoot);
  const addedPaths = current.filter((relativePath) => !initial.has(relativePath));
  const candidateDirectories = new Set<string>();

  for (const relativePath of addedPaths.sort(compareRelativePathsForRemoval)) {
    await rm(join(projectRoot, relativePath), { recursive: true, force: true });
    for (const directory of listParentDirectories(relativePath)) {
      if (!initialDirectoryPaths.has(directory)) {
        candidateDirectories.add(directory);
      }
    }
  }

  for (const directory of [...candidateDirectories].sort(compareRelativePathsForRemoval)) {
    await removeDirectoryIfEmpty(join(projectRoot, directory));
  }
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

function listParentDirectories(relativePath: string): string[] {
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

async function removeDirectoryIfEmpty(absolutePath: string): Promise<void> {
  try {
    await rmdir(absolutePath);
  } catch (error) {
    if (isNotEmptyDirectoryError(error) || isMissingPathError(error)) {
      return;
    }

    throw error;
  }
}

async function syncWorkspaceIntoProject(
  projectRoot: string,
  workspaceDir: string,
): Promise<WorkspaceSyncSummary> {
  const workspaceEntries = await listManagedProjectEntries(workspaceDir);
  const projectEntries = await listManagedProjectEntries(projectRoot);
  const workspaceSet = new Set(workspaceEntries.map((entry) => entry.path));
  const appliedFiles: string[] = [];

  for (const entry of workspaceEntries) {
    const changed = await syncManagedPath(workspaceDir, projectRoot, entry);
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
): Promise<boolean> {
  const sourcePath = join(sourceRoot, entry.path);
  const destinationPath = join(destinationRoot, entry.path);

  if (entry.kind === "dir") {
    return syncManagedDirectory(sourcePath, destinationPath);
  }

  if (entry.kind === "symlink") {
    return syncManagedSymlink(sourceRoot, sourcePath, destinationRoot, entry.path);
  }

  const destinationExists = await pathExists(destinationPath);
  const sourceStats = await lstat(sourcePath);
  const destinationMatches =
    destinationExists && (await fileContentsEqual(sourcePath, sourceStats.mode, destinationPath));
  if (destinationMatches) {
    return false;
  }

  if (destinationExists) {
    const destinationStats = await lstat(destinationPath);
    if (!destinationStats.isFile()) {
      await removeManagedDirectoryForReplacement(destinationRoot, entry.path, destinationStats);
    }
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, await readFile(sourcePath));
  await chmod(destinationPath, getManagedMode(sourceStats.mode));
  return true;
}

async function fileContentsEqual(
  leftPath: string,
  leftMode: number,
  rightPath: string,
): Promise<boolean> {
  const rightStats = await lstat(rightPath);
  if (!rightStats.isFile()) {
    return false;
  }

  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right) && getManagedMode(leftMode) === getManagedMode(rightStats.mode);
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
  });

  if (await symlinkMatches(destinationPath, replicatedTarget, sourceTargetType)) {
    return false;
  }

  if (await pathExists(destinationPath)) {
    const destinationStats = await lstat(destinationPath);
    if (destinationStats.isDirectory()) {
      await removeManagedDirectoryForReplacement(destinationRoot, relativePath, destinationStats);
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

async function createManagedProjectBackup(projectRoot: string, runId: string): Promise<string> {
  const backupRoot = await mkdtemp(join(tmpdir(), `oraculum-export-${runId}-`));
  try {
    await copyManagedProjectTree(projectRoot, backupRoot);
  } catch (error) {
    await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }

  return backupRoot;
}

async function restoreManagedProjectBackup(
  projectRoot: string,
  backupRoot: string,
): Promise<Error | undefined> {
  try {
    await syncWorkspaceIntoProject(projectRoot, backupRoot);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
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

async function restoreOptionalTextFile(path: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await rm(path, { force: true });
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function compareManagedEntriesForRemoval(left: ManagedPathEntry, right: ManagedPathEntry): number {
  const depthDelta = getPathDepth(right.path) - getPathDepth(left.path);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return right.path.localeCompare(left.path);
}

function getPathDepth(relativePath: string): number {
  return relativePath.split(/[\\/]+/u).length;
}

function compareRelativePathsForRemoval(left: string, right: string): number {
  const depthDelta = getPathDepth(right) - getPathDepth(left);
  if (depthDelta !== 0) {
    return depthDelta;
  }

  return right.localeCompare(left);
}

function getManagedMode(mode: number): number {
  return mode & 0o777;
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
): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  if (!destinationStats.isDirectory()) {
    await rm(absolutePath, { recursive: true, force: true });
    return;
  }

  const nestedManagedEntries = await listManagedProjectEntries(absolutePath);
  for (const entry of [...nestedManagedEntries].sort(compareManagedEntriesForRemoval)) {
    await removeManagedPath(absolutePath, entry);
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

function isNotEmptyDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOTEMPTY"
  );
}

async function markCandidateExported(
  projectRoot: string,
  manifest: RunManifest,
  candidateId: string,
): Promise<void> {
  const originalCandidate = manifest.candidates.find((candidate) => candidate.id === candidateId);
  const originalCandidateJson = originalCandidate
    ? `${JSON.stringify(originalCandidate, null, 2)}\n`
    : undefined;
  const updatedCandidates = manifest.candidates.map((candidate) =>
    candidate.id === candidateId
      ? candidateManifestSchema.parse({ ...candidate, status: "exported" })
      : candidate,
  );
  const nextManifest = runManifestSchema.parse({
    ...manifest,
    candidates: updatedCandidates,
  });

  const exportedCandidate = updatedCandidates.find((candidate) => candidate.id === candidateId);
  if (!exportedCandidate) {
    return;
  }

  const candidateManifestPath = getCandidateManifestPath(
    projectRoot,
    manifest.id,
    exportedCandidate.id,
  );
  const candidateManifestExisted = await pathExists(candidateManifestPath);

  try {
    await writeJsonFile(candidateManifestPath, exportedCandidate);
    await writeJsonFile(getRunManifestPath(projectRoot, manifest.id), nextManifest);
  } catch (error) {
    const restoreFailures: string[] = [];

    try {
      await writeJsonFile(getRunManifestPath(projectRoot, manifest.id), manifest);
    } catch (restoreError) {
      restoreFailures.push(`run manifest (${formatUnknownError(restoreError)})`);
    }

    try {
      if (candidateManifestExisted && originalCandidate && originalCandidateJson) {
        const currentManifestMatchesOriginal =
          (await pathExists(candidateManifestPath)) &&
          (await currentFileContentsMatch(candidateManifestPath, originalCandidateJson));
        if (!currentManifestMatchesOriginal) {
          await rm(candidateManifestPath, { recursive: true, force: true });
          await writeFile(candidateManifestPath, originalCandidateJson, "utf8");
        }
      } else if (!candidateManifestExisted) {
        await rm(candidateManifestPath, { force: true });
      }
    } catch (restoreError) {
      restoreFailures.push(`candidate manifest (${formatUnknownError(restoreError)})`);
    }

    if (restoreFailures.length > 0) {
      throw new OraculumError(
        `Failed to update crowning bookkeeping and restore previous metadata cleanly: ${restoreFailures.join(", ")}.`,
      );
    }

    throw error;
  }
}

async function currentFileContentsMatch(path: string, expected: string): Promise<boolean> {
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

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
  );
}
