import { chmod, cp, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";

export type ManagedPathKind = "dir" | "file" | "symlink";

export interface ManagedPathEntry {
  kind: ManagedPathKind;
  path: string;
}

export interface ManagedTreeOptions {
  relativeDir?: string;
  rules?: ManagedTreeRules;
}

const PROTECTED_UNMANAGED_ENTRY_NAMES = new Set([
  ".git",
  ".omc",
  ".oraculum",
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

const OVERRIDABLE_UNMANAGED_ENTRY_NAMES = new Set(["dist", "target"]);

const DEFAULT_UNMANAGED_ENTRY_NAMES = new Set([
  ...PROTECTED_UNMANAGED_ENTRY_NAMES,
  ...OVERRIDABLE_UNMANAGED_ENTRY_NAMES,
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]);

const LINKABLE_UNMANAGED_DEPENDENCY_TREE_NAMES = new Set([
  ".gradle",
  ".tox",
  ".venv",
  "node_modules",
  "target",
  "venv",
]);

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

export async function copyManagedProjectTree(
  sourceRoot: string,
  destinationRoot: string,
  options: ManagedTreeOptions = {},
): Promise<void> {
  const entries = await listManagedProjectEntries(sourceRoot, options);
  const { rules } = options;

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
      ...(rules ? { rules } : {}),
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
  rules?: ManagedTreeRules;
  sourcePath: string;
  sourceRoot: string;
  target: string;
  targetType: "file" | "dir" | "junction" | undefined;
}

export function normalizeManagedSymlinkTarget(options: ManagedSymlinkTargetOptions): string {
  if (!isAbsolute(options.target)) {
    return options.target;
  }

  const relativeToSourceRoot = relative(options.sourceRoot, options.target);
  if (
    isPathWithinRoot(relativeToSourceRoot) &&
    shouldManageProjectPath(relativeToSourceRoot, options.rules)
  ) {
    return join(options.destinationRoot, relativeToSourceRoot);
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

export function shouldManageProjectEntry(name: string, rules?: ManagedTreeRules): boolean {
  return shouldManageProjectPath(basename(name), rules);
}

export function shouldLinkProjectDependencyTree(
  relativePath: string,
  rules?: ManagedTreeRules,
): boolean {
  const normalizedPath = normalizeManagedTreePath(relativePath);
  if (!normalizedPath || shouldManageProjectPath(normalizedPath, rules)) {
    return false;
  }

  if (hasProtectedUnmanagedSegment(normalizedPath)) {
    return false;
  }

  return normalizedPath
    .split("/")
    .some((segment) => LINKABLE_UNMANAGED_DEPENDENCY_TREE_NAMES.has(segment));
}

export function shouldManageProjectPath(relativePath: string, rules?: ManagedTreeRules): boolean {
  const normalizedPath = normalizeManagedTreePath(relativePath);
  if (!normalizedPath) {
    return true;
  }

  if (hasProtectedUnmanagedSegment(normalizedPath)) {
    return false;
  }

  if (matchesManagedTreeRule(normalizedPath, rules?.excludePaths)) {
    return false;
  }

  const includedByRule = matchesManagedTreeIncludeRule(normalizedPath, rules?.includePaths);
  return normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .every((segment) => {
      if (!DEFAULT_UNMANAGED_ENTRY_NAMES.has(segment)) {
        return true;
      }

      return includedByRule && OVERRIDABLE_UNMANAGED_ENTRY_NAMES.has(segment);
    });
}

function normalizeManagedTreeOptions(options: ManagedTreeOptions | string): ManagedTreeOptions {
  return typeof options === "string" ? { relativeDir: options } : options;
}

function hasProtectedUnmanagedSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => {
    if (PROTECTED_UNMANAGED_ENTRY_NAMES.has(segment)) {
      return true;
    }

    return segment.startsWith(".env.");
  });
}

function matchesManagedTreeRule(relativePath: string, rulePaths: string[] | undefined): boolean {
  if (!rulePaths) {
    return false;
  }

  return rulePaths.some((rulePath) => {
    const normalizedRulePath = normalizeManagedTreePath(rulePath);
    return (
      normalizedRulePath.length > 0 &&
      (relativePath === normalizedRulePath || relativePath.startsWith(`${normalizedRulePath}/`))
    );
  });
}

function matchesManagedTreeIncludeRule(
  relativePath: string,
  rulePaths: string[] | undefined,
): boolean {
  if (!rulePaths) {
    return false;
  }

  return rulePaths.some((rulePath) => {
    const normalizedRulePath = normalizeManagedTreePath(rulePath);
    return (
      normalizedRulePath.length > 0 &&
      (relativePath === normalizedRulePath ||
        relativePath.startsWith(`${normalizedRulePath}/`) ||
        normalizedRulePath.startsWith(`${relativePath}/`))
    );
  });
}

function normalizeManagedTreePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .join("/");
}
