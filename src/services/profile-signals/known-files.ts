import { join } from "node:path";

import type { ManagedTreeRules } from "../../domain/config.js";
import { shouldManageProjectPath } from "../managed-tree.js";
import { KNOWN_SIGNAL_PATHS } from "../profile-detector-data.js";
import { pathExists } from "./shared.js";

export async function detectKnownFiles(
  projectRoot: string,
  workspaceRoots: string[] = [],
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const present = new Set<string>();
  for (const candidate of KNOWN_SIGNAL_PATHS) {
    if (!shouldManageProjectPath(candidate, rules)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(join(projectRoot, candidate))) {
      present.add(candidate);
    }
  }

  for (const workspaceRoot of workspaceRoots) {
    for (const candidate of KNOWN_SIGNAL_PATHS) {
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
