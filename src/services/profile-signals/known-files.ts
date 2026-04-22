import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { ManagedTreeRules } from "../../domain/config.js";
import { shouldManageProjectPath } from "../managed-tree.js";

const MAX_PROFILE_FILE_FACTS = 250;
const MAX_PROFILE_FILE_DEPTH = 4;

export async function detectKnownFiles(
  projectRoot: string,
  workspaceRoots: string[] = [],
  rules?: ManagedTreeRules,
): Promise<string[]> {
  const present = new Set<string>();
  const scanRoots = [".", ...workspaceRoots];

  for (const scanRoot of scanRoots) {
    // eslint-disable-next-line no-await-in-loop
    await collectManagedFileFacts(projectRoot, scanRoot, present, rules);
    if (present.size >= MAX_PROFILE_FILE_FACTS) {
      break;
    }
  }

  return [...present].sort((left, right) => left.localeCompare(right));
}

async function collectManagedFileFacts(
  projectRoot: string,
  scanRoot: string,
  present: Set<string>,
  rules: ManagedTreeRules | undefined,
  depth = 0,
): Promise<void> {
  if (present.size >= MAX_PROFILE_FILE_FACTS || depth > MAX_PROFILE_FILE_DEPTH) {
    return;
  }

  const relativeRoot = scanRoot === "." ? "" : scanRoot;
  if (relativeRoot && !shouldManageProjectPath(relativeRoot, rules)) {
    return;
  }

  let entries: Dirent<string>[];
  try {
    entries = await readdir(join(projectRoot, relativeRoot), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) =>
    String(left.name).localeCompare(String(right.name)),
  )) {
    if (present.size >= MAX_PROFILE_FILE_FACTS) {
      return;
    }

    const entryName = String(entry.name);
    const relativePath = relativeRoot ? `${relativeRoot}/${entryName}` : entryName;
    if (!shouldManageProjectPath(relativePath, rules)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (shouldSkipFactDirectory(entryName)) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await collectManagedFileFacts(projectRoot, relativePath, present, rules, depth + 1);
      continue;
    }

    if (entry.isFile()) {
      present.add(relative(projectRoot, join(projectRoot, relativePath)).replaceAll("\\", "/"));
    }
  }
}

function shouldSkipFactDirectory(name: string): boolean {
  return (
    name === ".git" ||
    name === ".oraculum" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "coverage"
  );
}
