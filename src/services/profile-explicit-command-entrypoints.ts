import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";

import { shouldManageProjectPath } from "./managed-tree.js";
import type { ExplicitCommandSurface } from "./profile-explicit-command-common.js";
import { normalizeCommandName } from "./profile-explicit-command-common.js";
import { pathExists } from "./project.js";

export async function collectLocalEntrypointSurfaces(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ExplicitCommandSurface[]> {
  const surfaces: ExplicitCommandSurface[] = [];
  for (const relativeDir of ["bin", "scripts"]) {
    if (!shouldManageProjectPath(relativeDir, options.rules)) {
      continue;
    }
    const dirPath = join(projectRoot, relativeDir);
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

    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const candidate = selectLocalEntrypointName(entry.name);
      if (!candidate) {
        continue;
      }
      const key = normalizeCommandName(candidate.baseName);
      grouped.set(key, [...(grouped.get(key) ?? []), candidate.fileName]);
    }

    for (const [normalizedName, fileNames] of [...grouped.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      const selectedFile = selectPlatformEntrypoint(fileNames);
      if (!selectedFile) {
        continue;
      }
      const relativePath = join(relativeDir, selectedFile);
      if (!shouldManageProjectPath(relativePath, options.rules)) {
        continue;
      }
      surfaces.push({
        kind: "local-entrypoint",
        name: normalizedName,
        normalizedName,
        command: relativePath,
        args: [],
        pathPolicy: "local-only",
        provenance: {
          signal: `entrypoint:${relativePath}`,
          source: "local-tool",
          path: relativePath,
          detail: "Repo-local executable entry point.",
        },
        safetyRationale:
          "Uses a repo-local entry point under scripts/ or bin/; execution stays inside the repository checkout.",
      });
    }
  }

  return surfaces;
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

function selectPlatformEntrypoint(fileNames: string[]): string | undefined {
  const preferredOrder = process.platform === "win32" ? [".cmd", ".bat", ".ps1"] : ["", ".sh"];
  for (const extension of preferredOrder) {
    const match = fileNames.find((fileName) => extname(fileName).toLowerCase() === extension);
    if (match) {
      return match;
    }
  }
  return undefined;
}
