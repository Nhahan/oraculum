import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, posix } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";

import { shouldManageProjectPath } from "./managed-tree.js";
import type { ExplicitCommandSurface } from "./profile-explicit-command-common.js";
import { normalizeCommandName } from "./profile-explicit-command-common.js";
import { pathExists } from "./project.js";

export interface LocalEntrypointSurfaceReport {
  ambiguousRootEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }>;
  ambiguousWorkspaceEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }>;
  surfaces: ExplicitCommandSurface[];
}

export async function collectLocalEntrypointSurfaces(
  projectRoot: string,
  options: { rules?: ManagedTreeRules; workspaceRoots?: string[] } = {},
): Promise<ExplicitCommandSurface[]> {
  const report = await collectLocalEntrypointSurfaceReport(projectRoot, options);
  return report.surfaces;
}

export async function collectLocalEntrypointSurfaceReport(
  projectRoot: string,
  options: { rules?: ManagedTreeRules; workspaceRoots?: string[] } = {},
): Promise<LocalEntrypointSurfaceReport> {
  const rootCandidates = await collectScopeLocalEntrypointSurfaces(
    projectRoot,
    undefined,
    options.rules,
  );
  const { ambiguousEntrypoints: ambiguousRootEntrypoints, surfaces: rootSurfaces } =
    resolveScopedEntrypoints(rootCandidates);
  const workspaceCandidates = (
    await Promise.all(
      (options.workspaceRoots ?? []).map((workspaceRoot) =>
        collectScopeLocalEntrypointSurfaces(projectRoot, workspaceRoot, options.rules),
      ),
    )
  ).flat();
  const rootBlockedNames = new Set(rootCandidates.map((surface) => surface.normalizedName));
  const workspaceGroups = groupWorkspaceEntrypointCandidates(workspaceCandidates);
  const surfaces = [
    ...rootSurfaces,
    ...[...workspaceGroups.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .flatMap(([, matches]) => {
        if (matches.length !== 1) {
          return [];
        }
        const [candidate] = matches;
        if (!candidate || rootBlockedNames.has(candidate.normalizedName)) {
          return [];
        }
        return [candidate];
      }),
  ].sort((left, right) => {
    const nameDelta = left.normalizedName.localeCompare(right.normalizedName);
    if (nameDelta !== 0) {
      return nameDelta;
    }
    return (left.relativeCwd ?? "").localeCompare(right.relativeCwd ?? "");
  });
  const ambiguousWorkspaceEntrypoints = [...workspaceGroups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .flatMap(([normalizedName, matches]) => {
      if (matches.length < 2 || rootBlockedNames.has(normalizedName)) {
        return [];
      }
      return [
        {
          normalizedName,
          entrypointPaths: matches
            .map((match) => match.provenance.path)
            .filter((path): path is string => typeof path === "string")
            .sort((left, right) => left.localeCompare(right)),
        },
      ];
    });

  return {
    ambiguousRootEntrypoints,
    ambiguousWorkspaceEntrypoints,
    surfaces,
  };
}

async function collectScopeLocalEntrypointSurfaces(
  projectRoot: string,
  relativeCwd: string | undefined,
  rules?: ManagedTreeRules,
): Promise<ExplicitCommandSurface[]> {
  const surfaces: ExplicitCommandSurface[] = [];
  for (const relativeDir of ["bin", "scripts"]) {
    const scopedDir = relativeCwd ? join(relativeCwd, relativeDir) : relativeDir;
    if (!shouldManageProjectPath(scopedDir, rules)) {
      continue;
    }
    const dirPath = join(projectRoot, scopedDir);
    if (!(await pathExists(dirPath))) {
      continue;
    }

    let entries: Dirent[];
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const grouped = new Map<string, Array<{ baseName: string; fileName: string }>>();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const candidate = selectLocalEntrypointName(entry.name);
      if (!candidate) {
        continue;
      }
      const key = normalizeCommandName(candidate.baseName);
      grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
    }

    for (const [normalizedName, fileNames] of [...grouped.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      const selectedEntrypoint = selectPlatformEntrypoint(fileNames);
      if (!selectedEntrypoint) {
        continue;
      }
      const scopedRelativePath = posix.join(scopedDir, selectedEntrypoint.fileName);
      if (!shouldManageProjectPath(scopedRelativePath, rules)) {
        continue;
      }
      const commandPath = posix.join(relativeDir, selectedEntrypoint.baseName);
      surfaces.push({
        kind: "local-entrypoint",
        name: normalizedName,
        normalizedName,
        command: commandPath,
        args: [],
        pathPolicy: "local-only",
        ...(relativeCwd ? { relativeCwd } : {}),
        provenance: {
          signal: `entrypoint:${scopedRelativePath}`,
          source: "local-tool",
          path: scopedRelativePath,
          detail: relativeCwd
            ? "Workspace-local executable entry point."
            : "Repo-local executable entry point.",
        },
        safetyRationale: relativeCwd
          ? "Uses a workspace-local entry point under scripts/ or bin/ with a validated workspace-relative cwd; execution stays inside the selected workspace."
          : "Uses a repo-local entry point under scripts/ or bin/; execution stays inside the repository checkout.",
      });
    }
  }

  return surfaces;
}

function groupWorkspaceEntrypointCandidates(
  surfaces: ExplicitCommandSurface[],
): Map<string, ExplicitCommandSurface[]> {
  const grouped = new Map<string, ExplicitCommandSurface[]>();
  for (const surface of surfaces) {
    grouped.set(surface.normalizedName, [...(grouped.get(surface.normalizedName) ?? []), surface]);
  }
  return grouped;
}

function resolveScopedEntrypoints(surfaces: ExplicitCommandSurface[]): {
  ambiguousEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }>;
  surfaces: ExplicitCommandSurface[];
} {
  const grouped = new Map<string, ExplicitCommandSurface[]>();
  for (const surface of surfaces) {
    grouped.set(surface.normalizedName, [...(grouped.get(surface.normalizedName) ?? []), surface]);
  }

  const selectedSurfaces: ExplicitCommandSurface[] = [];
  const ambiguousEntrypoints: Array<{
    entrypointPaths: string[];
    normalizedName: string;
  }> = [];
  for (const [normalizedName, matches] of [...grouped.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    if (matches.length === 1) {
      const [candidate] = matches;
      if (candidate) {
        selectedSurfaces.push(candidate);
      }
      continue;
    }
    ambiguousEntrypoints.push({
      normalizedName,
      entrypointPaths: matches
        .map((match) => match.provenance.path)
        .filter((path): path is string => typeof path === "string")
        .sort((left, right) => left.localeCompare(right)),
    });
  }

  return {
    ambiguousEntrypoints,
    surfaces: selectedSurfaces.sort((left, right) => {
      const nameDelta = left.normalizedName.localeCompare(right.normalizedName);
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return (left.relativeCwd ?? "").localeCompare(right.relativeCwd ?? "");
    }),
  };
}

function selectLocalEntrypointName(
  fileName: string,
): { baseName: string; fileName: string } | undefined {
  const extension = extname(fileName).toLowerCase();
  if (process.platform === "win32") {
    if (![".cmd", ".bat", ".ps1"].includes(extension)) {
      return undefined;
    }
  } else if (!(extension === "" || extension === ".sh")) {
    return undefined;
  }

  const baseName = extension === "" ? fileName : fileName.slice(0, -extension.length);
  if (baseName.length === 0) {
    return undefined;
  }
  return { baseName, fileName };
}

function selectPlatformEntrypoint(
  fileNames: Array<{ baseName: string; fileName: string }>,
): { baseName: string; fileName: string } | undefined {
  const preferredOrder = process.platform === "win32" ? [".cmd", ".bat", ".ps1"] : ["", ".sh"];
  for (const extension of preferredOrder) {
    const match = fileNames.find(
      (fileName) => extname(fileName.fileName).toLowerCase() === extension,
    );
    if (match) {
      return match;
    }
  }
  return undefined;
}
