import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ManagedTreeRules } from "../domain/config.js";

import { shouldManageProjectPath } from "./managed-tree.js";
import type { ExplicitCommandSurface } from "./profile-explicit-command-common.js";
import { normalizeCommandName } from "./profile-explicit-command-common.js";

export async function collectMakeTargetSurfaces(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ExplicitCommandSurface[]> {
  const makefilePath = await findFirstExistingPath(
    projectRoot,
    ["GNUmakefile", "Makefile", "makefile"],
    options.rules,
  );
  if (!makefilePath) {
    return [];
  }

  return (await enumerateMakeTargets(join(projectRoot, makefilePath))).map((target) => ({
    kind: "make-target" as const,
    name: target,
    normalizedName: normalizeCommandName(target),
    command: "make",
    args: [target],
    pathPolicy: "inherit" as const,
    provenance: {
      signal: `make-target:${target}`,
      source: "root-config" as const,
      path: makefilePath,
      detail: "Repo-local Make target.",
    },
    safetyRationale:
      "Uses an explicitly declared Make target from a repo-local Makefile; the command surface is owned by the repository.",
  }));
}

export async function collectJustTargetSurfaces(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ExplicitCommandSurface[]> {
  const justfilePath = await findFirstExistingPath(
    projectRoot,
    ["justfile", "Justfile"],
    options.rules,
  );
  if (!justfilePath) {
    return [];
  }

  return (await enumerateJustTargets(join(projectRoot, justfilePath))).map((target) => ({
    kind: "just-target" as const,
    name: target,
    normalizedName: normalizeCommandName(target),
    command: "just",
    args: [target],
    pathPolicy: "inherit" as const,
    provenance: {
      signal: `just-target:${target}`,
      source: "root-config" as const,
      path: justfilePath,
      detail: "Repo-local just target.",
    },
    safetyRationale:
      "Uses an explicitly declared just target from a repo-local justfile; the command surface is owned by the repository.",
  }));
}

export async function collectTaskfileTargetSurfaces(
  projectRoot: string,
  options: { rules?: ManagedTreeRules } = {},
): Promise<ExplicitCommandSurface[]> {
  const taskfilePath = await findFirstExistingPath(
    projectRoot,
    ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"],
    options.rules,
  );
  if (!taskfilePath) {
    return [];
  }

  return (await enumerateTaskfileTargets(join(projectRoot, taskfilePath))).map((target) => ({
    kind: "taskfile-target" as const,
    name: target,
    normalizedName: normalizeCommandName(target),
    command: "task",
    args: [target],
    pathPolicy: "inherit" as const,
    provenance: {
      signal: `task-target:${target}`,
      source: "root-config" as const,
      path: taskfilePath,
      detail: "Repo-local Taskfile task.",
    },
    safetyRationale:
      "Uses an explicitly declared Taskfile task from a repo-local Taskfile; the command surface is owned by the repository.",
  }));
}

async function findFirstExistingPath(
  projectRoot: string,
  candidates: readonly string[],
  rules?: ManagedTreeRules,
): Promise<string | undefined> {
  let entryNames: Set<string>;
  try {
    entryNames = new Set(await readdir(projectRoot));
  } catch {
    return undefined;
  }

  for (const candidate of candidates) {
    if (!entryNames.has(candidate)) {
      continue;
    }
    if (!shouldManageProjectPath(candidate, rules)) {
      continue;
    }
    return candidate;
  }

  return undefined;
}

async function enumerateMakeTargets(filePath: string): Promise<string[]> {
  const source = await readFile(filePath, "utf8");
  const targets = new Set<string>();

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || line.startsWith("\t")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(?:\s|$)/u);
    const target = match?.[1];
    if (!target || target.startsWith(".")) {
      continue;
    }
    targets.add(target);
  }

  return [...targets].sort((left, right) => left.localeCompare(right));
}

async function enumerateJustTargets(filePath: string): Promise<string[]> {
  const source = await readFile(filePath, "utf8");
  const targets = new Set<string>();

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("[")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s|$)/u);
    const target = match?.[1];
    if (target) {
      targets.add(target);
    }
  }

  return [...targets].sort((left, right) => left.localeCompare(right));
}

async function enumerateTaskfileTargets(filePath: string): Promise<string[]> {
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/u);
  const targets = new Set<string>();
  let tasksIndent: number | undefined;

  for (const line of lines) {
    const indent = line.match(/^\s*/u)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (tasksIndent === undefined) {
      if (trimmed === "tasks:") {
        tasksIndent = indent;
      }
      continue;
    }
    if (indent <= tasksIndent) {
      break;
    }
    const match = line.match(/^\s+([A-Za-z0-9][A-Za-z0-9_.-]*):\s*$/u);
    const target = match?.[1];
    if (target && indent === tasksIndent + 2) {
      targets.add(target);
    }
  }

  return [...targets].sort((left, right) => left.localeCompare(right));
}
