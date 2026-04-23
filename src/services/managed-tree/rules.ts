import { basename, isAbsolute, win32 } from "node:path";

import type { ManagedTreeRules } from "../../domain/config.js";
import type { ManagedTreeOptions } from "./types.js";

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

const PROTECTED_UNMANAGED_PATHS = new Set([
  ".azure/accessTokens.json",
  ".azure/azureProfile.json",
  ".config/gcloud/application_default_credentials.json",
  ".config/gcloud/credentials.db",
  ".docker/config.json",
]);

const PROTECTED_UNMANAGED_PATH_PREFIXES = [".config/gcloud/legacy_credentials"];

const OVERRIDABLE_UNMANAGED_ENTRY_NAMES = new Set([
  ".idea",
  ".pulumi",
  ".serverless",
  ".terraform",
  "dist",
  "target",
]);

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

export function shouldManageProjectEntry(name: string, rules?: ManagedTreeRules): boolean {
  return shouldManageProjectPath(basename(name), rules);
}

export function shouldLinkProjectDependencyTree(
  relativePath: string,
  rules?: ManagedTreeRules,
): boolean {
  if (isUnsafeManagedTreePath(relativePath)) {
    return false;
  }

  const normalizedPath = normalizeManagedTreePath(relativePath);
  if (!normalizedPath || shouldManageProjectPath(normalizedPath, rules)) {
    return false;
  }

  if (hasProtectedUnmanagedSegment(normalizedPath) || hasProtectedUnmanagedPath(normalizedPath)) {
    return false;
  }

  return normalizedPath
    .split("/")
    .some((segment) => LINKABLE_UNMANAGED_DEPENDENCY_TREE_NAMES.has(segment));
}

export function shouldManageProjectPath(relativePath: string, rules?: ManagedTreeRules): boolean {
  if (isUnsafeManagedTreePath(relativePath)) {
    return false;
  }

  const normalizedPath = normalizeManagedTreePath(relativePath);
  if (!normalizedPath) {
    return true;
  }

  if (hasProtectedUnmanagedSegment(normalizedPath) || hasProtectedUnmanagedPath(normalizedPath)) {
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

export function normalizeManagedTreeOptions(
  options: ManagedTreeOptions | string,
): ManagedTreeOptions {
  return typeof options === "string" ? { relativeDir: options } : options;
}

export function getManagedMode(mode: number): number {
  return mode & 0o777;
}

export function isPathWithinRoot(relativePath: string): boolean {
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !isPortableAbsolutePath(relativePath))
  );
}

export function isPortableAbsolutePath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path);
}

function hasProtectedUnmanagedSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => {
    if (PROTECTED_UNMANAGED_ENTRY_NAMES.has(segment)) {
      return true;
    }

    return segment.startsWith(".env.");
  });
}

function hasProtectedUnmanagedPath(relativePath: string): boolean {
  if (PROTECTED_UNMANAGED_PATHS.has(relativePath)) {
    return true;
  }

  return PROTECTED_UNMANAGED_PATH_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
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

function isUnsafeManagedTreePath(relativePath: string): boolean {
  return (
    relativePath.includes("\0") ||
    isPortableAbsolutePath(relativePath) ||
    relativePath.split(/[\\/]+/u).includes("..")
  );
}

function normalizeManagedTreePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .join("/");
}
