import { chmod, cp, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type ManagedPathKind = "dir" | "file" | "symlink";

export interface ManagedPathEntry {
  kind: ManagedPathKind;
  path: string;
}

const UNMANAGED_ENTRY_NAMES = new Set([
  ".git",
  ".omc",
  ".oraculum",
  "dist",
  "node_modules",
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
]);

export function shouldManageProjectEntry(name: string): boolean {
  const base = basename(name);
  if (UNMANAGED_ENTRY_NAMES.has(base)) {
    return false;
  }

  if (base.startsWith(".env.")) {
    return false;
  }

  return true;
}

export function shouldManageProjectPath(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .every((segment) => shouldManageProjectEntry(segment));
}

export async function listManagedProjectEntries(
  root: string,
  relativeDir = "",
): Promise<ManagedPathEntry[]> {
  const directory = relativeDir ? join(root, relativeDir) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const managedEntries: ManagedPathEntry[] = [];

  for (const entry of entries) {
    if (!shouldManageProjectEntry(entry.name)) {
      continue;
    }

    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      managedEntries.push({
        kind: "dir",
        path: relativePath,
      });
      managedEntries.push(...(await listManagedProjectEntries(root, relativePath)));
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

export async function copyManagedProjectTree(
  sourceRoot: string,
  destinationRoot: string,
): Promise<void> {
  const entries = await listManagedProjectEntries(sourceRoot);

  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.path);
    const destinationPath = join(destinationRoot, entry.path);

    if (entry.kind === "dir") {
      await mkdir(destinationPath, { recursive: true });
      const sourceStats = await lstat(sourcePath);
      await chmod(destinationPath, getManagedMode(sourceStats.mode));
      continue;
    }

    if (entry.kind === "file") {
      await mkdir(dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath, { force: true, recursive: false });
      const sourceStats = await lstat(sourcePath);
      await chmod(destinationPath, getManagedMode(sourceStats.mode));
      continue;
    }

    const target = await readlink(sourcePath);
    const targetType = await readSymlinkTargetType(sourcePath);
    const replicatedTarget = normalizeManagedSymlinkTarget({
      destinationPath,
      destinationRoot,
      sourcePath,
      sourceRoot,
      target,
      targetType,
    });
    await mkdir(dirname(destinationPath), { recursive: true });
    await symlink(replicatedTarget, destinationPath, targetType);
  }
}

export async function readSymlinkTargetType(
  absolutePath: string,
): Promise<"file" | "dir" | "junction" | undefined> {
  try {
    const target = await readlink(absolutePath);
    const targetStats = await stat(absolutePath);
    if (!targetStats.isDirectory()) {
      return "file";
    }

    if (process.platform !== "win32") {
      return "dir";
    }

    return isAbsolute(target) ? "junction" : "dir";
  } catch {
    return undefined;
  }
}

interface ManagedSymlinkTargetOptions {
  destinationPath: string;
  destinationRoot: string;
  sourcePath: string;
  sourceRoot: string;
  target: string;
  targetType: "file" | "dir" | "junction" | undefined;
}

export function normalizeManagedSymlinkTarget(options: ManagedSymlinkTargetOptions): string {
  if (options.targetType !== "junction" || !isAbsolute(options.target)) {
    return options.target;
  }

  const relativeToSourceRoot = relative(options.sourceRoot, options.target);
  if (isPathWithinRoot(relativeToSourceRoot)) {
    return join(options.destinationRoot, relativeToSourceRoot);
  }

  const relativeToSourceLink = relative(dirname(options.sourcePath), options.target);
  if (isPathWithinRoot(relativeToSourceLink)) {
    return resolve(dirname(options.destinationPath), relativeToSourceLink);
  }

  return options.target;
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

function getManagedMode(mode: number): number {
  return mode & 0o777;
}

function isPathWithinRoot(relativePath: string): boolean {
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
