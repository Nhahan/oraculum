import { lstat } from "node:fs/promises";

import type { ProfileCapabilitySignal } from "../../domain/profile.js";

export function collectManifestDependencies(
  manifest:
    | {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }
    | undefined,
): string[] {
  return Object.keys({
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  });
}

export function hasPackageExportMetadata(
  manifest:
    | {
        exports?: unknown;
        main?: string;
        module?: string;
        types?: string;
      }
    | undefined,
): boolean {
  return (
    manifest?.exports !== undefined || !!manifest?.main || !!manifest?.module || !!manifest?.types
  );
}

export function findSignalPath(files: Set<string>, expectedPaths: string[]): string | undefined {
  for (const expectedPath of expectedPaths) {
    if (files.has(expectedPath)) {
      return expectedPath;
    }
  }

  return [...files].find((file) =>
    expectedPaths.some((expectedPath) => file.endsWith(`/${expectedPath}`)),
  );
}

export function signalSourceForPath(
  signalPath: string,
  rootSignalPaths: string[],
): ProfileCapabilitySignal["source"] {
  return rootSignalPaths.includes(signalPath) ? "root-config" : "workspace-config";
}

export async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await lstat(candidatePath);
    return true;
  } catch {
    return false;
  }
}
