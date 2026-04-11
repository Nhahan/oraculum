import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";
import type { PackageManager, ProfileSignalProvenance } from "../domain/profile.js";

import { shouldManageProjectPath } from "./managed-tree.js";
import { WORKSPACE_MARKER_FILES } from "./profile-detector-data.js";
import { detectKnownFiles, detectWorkspaceRoots } from "./profile-signals.js";
import { pathExists } from "./project.js";

const PACKAGE_MANAGER_LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const KNOWN_LOCKFILES = [
  ...new Set([
    ...PACKAGE_MANAGER_LOCKFILES.map(([filename]) => filename),
    "poetry.lock",
    "uv.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "go.sum",
    "gradle.lockfile",
  ]),
];

export interface ProfilePackageJsonManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  main?: string;
  module?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  types?: string;
}

export interface WorkspacePackageJsonManifest {
  manifestPath: string;
  packageJson: ProfilePackageJsonManifest;
  root: string;
}

export interface ProfileRepoFacts {
  dependencies: string[];
  files: string[];
  lockfiles: string[];
  manifests: string[];
  packageJson?: ProfilePackageJsonManifest;
  packageManager: PackageManager;
  packageManagerEvidence?: {
    detail: string;
    path?: string;
    source: ProfileSignalProvenance["source"];
  };
  scripts: string[];
  workspacePackageJsons: WorkspacePackageJsonManifest[];
  workspaceMetadata: Array<{
    label: string;
    manifests: string[];
    root: string;
  }>;
  workspaceRoots: string[];
}

export async function collectProfileRepoFacts(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ProfileRepoFacts> {
  const packageJson = await readPackageJson(projectRoot, options.rules);
  const workspaceRoots = await detectWorkspaceRoots(projectRoot, options.rules);
  const workspacePackageJsons = await collectWorkspacePackageJsons(
    projectRoot,
    workspaceRoots,
    options.rules,
  );
  const packageManagerResolution = await detectPackageManager(projectRoot, {
    rootPackageManagerField: packageJson?.packageManager,
    workspacePackageJsons,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const files = await detectKnownFiles(projectRoot, workspaceRoots, options.rules);
  const manifests = await collectRelativePaths(
    projectRoot,
    WORKSPACE_MARKER_FILES,
    workspaceRoots,
    options.rules,
  );
  const lockfiles = await collectRelativePaths(
    projectRoot,
    KNOWN_LOCKFILES,
    workspaceRoots,
    options.rules,
  );
  const workspaceMetadata = buildWorkspaceMetadata(workspaceRoots, manifests);
  const scripts = [
    ...new Set([
      ...collectManifestScripts(packageJson),
      ...workspacePackageJsons.flatMap((workspaceManifest) =>
        collectManifestScripts(workspaceManifest.packageJson),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const dependencies = [
    ...new Set([
      ...collectManifestDependencies(packageJson),
      ...workspacePackageJsons.flatMap((workspaceManifest) =>
        collectManifestDependencies(workspaceManifest.packageJson),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));

  return {
    dependencies,
    files,
    lockfiles,
    manifests,
    ...(packageJson ? { packageJson } : {}),
    packageManager: packageManagerResolution.packageManager,
    ...(packageManagerResolution.evidence
      ? { packageManagerEvidence: packageManagerResolution.evidence }
      : {}),
    scripts,
    workspacePackageJsons,
    workspaceMetadata,
    workspaceRoots,
  };
}

export async function detectPackageManager(
  projectRoot: string,
  options: {
    rootPackageManagerField: string | undefined;
    rules?: ManagedTreeRules;
    workspacePackageJsons: WorkspacePackageJsonManifest[];
  },
): Promise<{
  evidence?: {
    detail: string;
    path?: string;
    source: ProfileSignalProvenance["source"];
  };
  packageManager: PackageManager;
}> {
  const rootPackageManager = detectPackageManagerFromField(options.rootPackageManagerField);
  if (rootPackageManager) {
    return {
      packageManager: rootPackageManager,
      evidence: {
        detail: "Package manager detected from package metadata.",
        path: "package.json",
        source: "root-config",
      },
    };
  }

  for (const [filename, manager] of PACKAGE_MANAGER_LOCKFILES) {
    if (!shouldManageProjectPath(filename, options.rules)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, filename))) {
      return {
        packageManager: manager,
        evidence: {
          detail: "Package manager detected from a lockfile.",
          source: "root-config",
        },
      };
    }
  }

  const workspaceMatches = options.workspacePackageJsons
    .map((workspaceManifest) => {
      const packageManager = detectPackageManagerFromField(
        workspaceManifest.packageJson.packageManager,
      );
      return packageManager
        ? {
            manifestPath: workspaceManifest.manifestPath,
            packageManager,
          }
        : undefined;
    })
    .filter(
      (value): value is { manifestPath: string; packageManager: PackageManager } =>
        value !== undefined,
    );
  const workspaceManagers = [...new Set(workspaceMatches.map((match) => match.packageManager))];
  if (workspaceManagers.length === 1) {
    const [packageManager] = workspaceManagers;
    const [firstMatch] = workspaceMatches;
    if (!packageManager || !firstMatch) {
      return { packageManager: "unknown" };
    }
    return {
      packageManager,
      evidence: {
        detail:
          workspaceMatches.length === 1
            ? "Package manager detected from workspace package metadata."
            : "Package manager detected consistently across workspace package metadata.",
        ...(workspaceMatches.length === 1 ? { path: firstMatch.manifestPath } : {}),
        source: "workspace-config",
      },
    };
  }

  return { packageManager: "unknown" };
}

async function readPackageJson(
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<ProfilePackageJsonManifest | undefined> {
  const packageJsonPath = join(projectRoot, "package.json");
  if (!shouldManageProjectPath("package.json", rules) || !(await pathExists(packageJsonPath))) {
    return undefined;
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8")) as ProfilePackageJsonManifest;
}

async function collectRelativePaths(
  projectRoot: string,
  candidates: readonly string[],
  workspaceRoots: readonly string[],
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const present = new Set<string>();

  for (const candidate of candidates) {
    if (!shouldManageProjectPath(candidate, rules)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, candidate))) {
      present.add(candidate);
    }
  }

  for (const workspaceRoot of workspaceRoots) {
    for (const candidate of candidates) {
      const relativePath = `${workspaceRoot}/${candidate}`;
      if (!shouldManageProjectPath(relativePath, rules)) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(join(projectRoot, relativePath))) {
        present.add(relativePath);
      }
    }
  }

  return [...present].sort((left, right) => left.localeCompare(right));
}

async function collectWorkspacePackageJsons(
  projectRoot: string,
  workspaceRoots: readonly string[],
  rules?: ManagedTreeRules,
): Promise<WorkspacePackageJsonManifest[]> {
  const manifests: WorkspacePackageJsonManifest[] = [];

  for (const root of workspaceRoots) {
    const manifestPath = `${root}/package.json`;
    if (!shouldManageProjectPath(manifestPath, rules)) {
      continue;
    }

    const absolutePath = join(projectRoot, manifestPath);
    // eslint-disable-next-line no-await-in-loop
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    manifests.push({
      manifestPath,
      packageJson: JSON.parse(
        // eslint-disable-next-line no-await-in-loop
        await readFile(absolutePath, "utf8"),
      ) as ProfilePackageJsonManifest,
      root,
    });
  }

  return manifests.sort((left, right) => left.root.localeCompare(right.root));
}

function buildWorkspaceMetadata(
  workspaceRoots: readonly string[],
  manifests: readonly string[],
): Array<{ label: string; manifests: string[]; root: string }> {
  return workspaceRoots.map((root) => ({
    root,
    label: basename(root),
    manifests: manifests.filter((manifestPath) => manifestPath.startsWith(`${root}/`)),
  }));
}

function collectManifestDependencies(manifest: ProfilePackageJsonManifest | undefined): string[] {
  return Object.keys({
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  });
}

function collectManifestScripts(manifest: ProfilePackageJsonManifest | undefined): string[] {
  return Object.keys(manifest?.scripts ?? {});
}

function detectPackageManagerFromField(
  packageManagerField: string | undefined,
): PackageManager | undefined {
  if (packageManagerField?.startsWith("pnpm")) {
    return "pnpm";
  }
  if (packageManagerField?.startsWith("yarn")) {
    return "yarn";
  }
  if (packageManagerField?.startsWith("bun")) {
    return "bun";
  }
  if (packageManagerField?.startsWith("npm")) {
    return "npm";
  }
  return undefined;
}
