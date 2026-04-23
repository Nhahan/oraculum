import { join } from "node:path";

import type { ManagedTreeRules } from "../../../domain/config.js";
import type { PackageManager, ProfileSignalProvenance } from "../../../domain/profile.js";
import { shouldManageProjectPath } from "../../managed-tree.js";
import { pathExists } from "../../project.js";
import type { WorkspacePackageJsonManifest } from "./types.js";

const PACKAGE_MANAGER_LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

export const KNOWN_LOCKFILES = [
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
