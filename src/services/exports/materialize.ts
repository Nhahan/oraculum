import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { resolveProjectRoot } from "../../core/paths.js";
import {
  type ExportPlan,
  exportPlanSchema,
  getExportMaterializationMode,
} from "../../domain/run.js";
import { RunStore } from "../run-store.js";
import { assertCrownSafetyGate } from "../runs/export-plan.js";
import { prepareExportPlan, readRunManifest } from "../runs.js";

import {
  findExportCandidate,
  markCandidateExported,
  readRunManagedTreeRules,
} from "./bookkeeping.js";
import { materializeGitApplyExport, materializeGitBranchExport } from "./git.js";
import { formatUnknownError, readOptionalTextFile, restoreOptionalTextFile } from "./shared.js";
import type { MaterializeExportOptions } from "./types.js";
import { materializeWorkspaceSyncExport } from "./workspace-sync.js";

export async function materializeExport(
  options: MaterializeExportOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const store = new RunStore(projectRoot);
  const { path, plan: planned } = await prepareExportPlan(options);
  const syncSummaryPath = store.getRunPaths(planned.runId).exportSyncSummaryPath;
  const manifest = await readRunManifest(projectRoot, planned.runId);
  await assertCrownSafetyGate({
    allowUnsafe: planned.safetyOverride === "operator-allow-unsafe",
    manifest,
    projectRoot,
  });
  const managedTreeRules = await readRunManagedTreeRules(projectRoot, manifest);
  const winner = findExportCandidate(manifest, planned.winnerId);
  const [previousPlanContents, previousSyncSummaryContents] = await Promise.all([
    readOptionalTextFile(path),
    readOptionalTextFile(syncSummaryPath),
  ]);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(dirname(syncSummaryPath), { recursive: true });

  const materializationMode = getExportMaterializationMode(planned);
  const outcome =
    materializationMode === "branch"
      ? await materializeGitBranchExport(projectRoot, planned, winner, managedTreeRules)
      : materializationMode === "working-tree"
        ? await materializeGitApplyExport(projectRoot, planned, winner, managedTreeRules)
        : await materializeWorkspaceSyncExport(projectRoot, planned, winner, managedTreeRules);

  const updatedPlan = exportPlanSchema.parse({
    ...planned,
    ...outcome.partialPlan,
  });

  try {
    if (outcome.syncSummary) {
      await store.writeJsonArtifact(syncSummaryPath, outcome.syncSummary);
    }

    await store.writeJsonArtifact(path, updatedPlan);
    await markCandidateExported(store, manifest, winner.id);
  } catch (error) {
    const cleanupFailures: string[] = [];

    try {
      await outcome.rollback();
    } catch (rollbackError) {
      throw new OraculumError(
        `Crowning bookkeeping failed after applying changes and rollback did not complete cleanly: ${formatUnknownError(error)}; rollback error: ${formatUnknownError(rollbackError)}`,
      );
    }

    try {
      await restoreOptionalTextFile(path, previousPlanContents);
    } catch (restoreError) {
      cleanupFailures.push(`crowning record (${formatUnknownError(restoreError)})`);
    }

    try {
      await restoreOptionalTextFile(syncSummaryPath, previousSyncSummaryContents);
    } catch (restoreError) {
      cleanupFailures.push(`workspace-sync summary (${formatUnknownError(restoreError)})`);
    }

    try {
      await outcome.cleanup();
    } catch (cleanupError) {
      cleanupFailures.push(`temporary cleanup (${formatUnknownError(cleanupError)})`);
    }

    if (cleanupFailures.length > 0) {
      throw new OraculumError(
        `Crowning bookkeeping failed after applying changes and the crowning was rolled back, but cleanup did not complete cleanly: ${cleanupFailures.join(", ")}.`,
      );
    }

    throw new OraculumError(
      `Crowning bookkeeping failed after applying changes and the crowning was rolled back: ${formatUnknownError(error)}`,
    );
  }

  await outcome.cleanup();

  return {
    plan: updatedPlan,
    path,
  };
}
