import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ManagedTreeRules } from "../../domain/config.js";
import { WORKSPACE_MARKER_FILES } from "../consultation-profile/detector-data.js";
import { shouldManageProjectPath } from "../managed-tree.js";

export async function detectWorkspaceRoots(
  projectRoot: string,
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const workspaceRoots = new Set<string>();

  await collectWorkspaceRoots(projectRoot, "", workspaceRoots, rules);

  return [...workspaceRoots].sort((left, right) => left.localeCompare(right));
}

async function collectWorkspaceRoots(
  projectRoot: string,
  relativeDir: string,
  workspaceRoots: Set<string>,
  rules?: ManagedTreeRules,
): Promise<void> {
  const absoluteDir = relativeDir ? join(projectRoot, relativeDir) : projectRoot;
  let entries: Dirent[];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  const entryNames = new Set(entries.map((entry) => entry.name));
  if (
    relativeDir &&
    WORKSPACE_MARKER_FILES.some(
      (marker) =>
        entryNames.has(marker) && shouldManageProjectPath(`${relativeDir}/${marker}`, rules),
    )
  ) {
    workspaceRoots.add(relativeDir);
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const childRelativeDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (!shouldManageProjectPath(childRelativeDir, rules)) {
      continue;
    }
    await collectWorkspaceRoots(projectRoot, childRelativeDir, workspaceRoots, rules);
  }
}
