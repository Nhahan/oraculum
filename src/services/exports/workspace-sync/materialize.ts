import { rm } from "node:fs/promises";

import { OraculumError } from "../../../core/errors.js";
import type { ManagedTreeRules } from "../../../domain/config.js";
import type { CandidateManifest, ExportPlan } from "../../../domain/run.js";
import { assertManagedProjectSnapshotUnchanged } from "../../base-snapshots.js";

import { formatUnknownError } from "../shared.js";
import type { MaterializationOutcome } from "../types.js";

import { createManagedProjectBackup, restoreManagedProjectBackup } from "./backup.js";
import { syncWorkspaceIntoProject } from "./sync.js";

export async function materializeWorkspaceSyncExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
  managedTreeRules: ManagedTreeRules,
): Promise<MaterializationOutcome> {
  if (!winner.baseSnapshotPath) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the project snapshot it was generated from.`,
    );
  }

  await assertManagedProjectSnapshotUnchanged(projectRoot, winner.baseSnapshotPath, {
    rules: managedTreeRules,
  });
  const backupRoot = await createManagedProjectBackup(projectRoot, plan.runId, managedTreeRules);
  try {
    const summary = await syncWorkspaceIntoProject(
      projectRoot,
      winner.workspaceDir,
      managedTreeRules,
    );
    return {
      async cleanup() {
        await rm(backupRoot, { recursive: true, force: true });
      },
      partialPlan: {
        appliedPathCount: summary.appliedFiles.length,
        removedPathCount: summary.removedFiles.length,
      },
      async rollback() {
        const rollbackError = await restoreManagedProjectBackup(
          projectRoot,
          backupRoot,
          managedTreeRules,
        );
        if (rollbackError) {
          throw rollbackError;
        }
      },
      syncSummary: summary,
    };
  } catch (error) {
    try {
      const rollbackError = await restoreManagedProjectBackup(
        projectRoot,
        backupRoot,
        managedTreeRules,
      );
      if (rollbackError) {
        throw new OraculumError(
          `Workspace-sync materialization failed and rollback did not complete cleanly: ${formatUnknownError(error)}; rollback error: ${rollbackError.message}`,
        );
      }
    } finally {
      await rm(backupRoot, { recursive: true, force: true });
    }

    throw error;
  }
}
