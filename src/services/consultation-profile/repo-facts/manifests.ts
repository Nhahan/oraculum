import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ManagedTreeRules } from "../../../domain/config.js";
import { shouldManageProjectPath } from "../../managed-tree.js";
import { pathExists } from "../../project.js";
import type { ProfilePackageJsonManifest, WorkspacePackageJsonManifest } from "./types.js";

export async function readPackageJson(
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<{ invalidPaths: string[]; packageJson?: ProfilePackageJsonManifest }> {
  const packageJsonPath = join(projectRoot, "package.json");
  if (!shouldManageProjectPath("package.json", rules) || !(await pathExists(packageJsonPath))) {
    return { invalidPaths: [] };
  }

  try {
    return {
      packageJson: parsePackageJsonManifest(await readFile(packageJsonPath, "utf8")),
      invalidPaths: [],
    };
  } catch {
    return { invalidPaths: ["package.json"] };
  }
}

export async function collectRelativePaths(
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

export async function collectWorkspacePackageJsons(
  projectRoot: string,
  workspaceRoots: readonly string[],
  rules?: ManagedTreeRules,
): Promise<{ invalidPaths: string[]; manifests: WorkspacePackageJsonManifest[] }> {
  const manifests: WorkspacePackageJsonManifest[] = [];
  const invalidPaths: string[] = [];

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

    try {
      manifests.push({
        manifestPath,
        packageJson: parsePackageJsonManifest(
          // eslint-disable-next-line no-await-in-loop
          await readFile(absolutePath, "utf8"),
        ),
        root,
      });
    } catch {
      invalidPaths.push(manifestPath);
    }
  }

  return {
    invalidPaths: invalidPaths.sort((left, right) => left.localeCompare(right)),
    manifests: manifests.sort((left, right) => left.root.localeCompare(right.root)),
  };
}

export function buildWorkspaceMetadata(
  workspaceRoots: readonly string[],
  manifests: readonly string[],
): Array<{ label: string; manifests: string[]; root: string }> {
  return workspaceRoots.map((root) => ({
    root,
    label: basename(root),
    manifests: manifests.filter((manifestPath) => manifestPath.startsWith(`${root}/`)),
  }));
}

export function collectManifestDependencies(
  manifest: ProfilePackageJsonManifest | undefined,
): string[] {
  return Object.keys({
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  });
}

export function collectManifestScripts(manifest: ProfilePackageJsonManifest | undefined): string[] {
  return Object.keys(manifest?.scripts ?? {});
}

function parsePackageJsonManifest(contents: string): ProfilePackageJsonManifest {
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("package.json must contain a JSON object.");
  }

  return parsed as ProfilePackageJsonManifest;
}
