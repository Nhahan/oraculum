import { chmod, cp, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type ManagedPathKind = "dir" | "file" | "symlink";

export interface ManagedPathEntry {
  kind: ManagedPathKind;
  path: string;
}

export function shouldManageProjectEntry(name: string): boolean {
  const base = basename(name);
  if ([".git", ".oraculum", "dist", "node_modules"].includes(base)) {
    return false;
  }

  if (
    [
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
    ].includes(base)
  ) {
    return false;
  }

  if (base.startsWith(".env.")) {
    return false;
  }

  return true;
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
    await mkdir(dirname(destinationPath), { recursive: true });
    await symlink(target, destinationPath, targetType);
  }
}

export async function readSymlinkTargetType(
  absolutePath: string,
): Promise<"file" | "dir" | "junction" | undefined> {
  try {
    const targetStats = await stat(absolutePath);
    if (!targetStats.isDirectory()) {
      return "file";
    }

    return process.platform === "win32" ? "junction" : "dir";
  } catch {
    return undefined;
  }
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
