import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManagedTreeRules } from "../../../domain/config.js";

import { copyManagedProjectTree } from "../../managed-tree.js";

import { syncWorkspaceIntoProject } from "./sync.js";

export async function createManagedProjectBackup(
  projectRoot: string,
  runId: string,
  managedTreeRules: ManagedTreeRules,
): Promise<string> {
  const backupRoot = await mkdtemp(join(tmpdir(), `oraculum-export-${runId}-`));
  try {
    await copyManagedProjectTree(projectRoot, backupRoot, { rules: managedTreeRules });
  } catch (error) {
    await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }

  return backupRoot;
}

export async function restoreManagedProjectBackup(
  projectRoot: string,
  backupRoot: string,
  managedTreeRules: ManagedTreeRules,
): Promise<Error | undefined> {
  try {
    await syncWorkspaceIntoProject(projectRoot, backupRoot, managedTreeRules);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
