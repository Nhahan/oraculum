import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import type { ManagedTreeRules } from "../../domain/config.js";
import type { CandidateManifest, ExportPlan } from "../../domain/run.js";
import { getExportMaterializationPatchPath } from "../../domain/run.js";
import { writeTextFileAtomically } from "../project.js";
import { RunStore } from "../run-store.js";
import { generateWorkspacePatch } from "./git/patch.js";
import { rollbackFailedGitApplyExport, rollbackFailedGitBranchExport } from "./git/rollback.js";
import { captureGitExportState } from "./git/state.js";
import {
  ensureBranchDoesNotExist,
  ensureCleanGitWorkingTree,
  requireGitBranchName,
} from "./git/validation.js";
import { formatUnknownError } from "./shared.js";
import type { MaterializationOutcome } from "./types.js";

export async function materializeGitApplyExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
  managedTreeRules: ManagedTreeRules,
): Promise<MaterializationOutcome> {
  const store = new RunStore(projectRoot);
  const patchPath =
    getExportMaterializationPatchPath(plan) ?? store.getRunPaths(plan.runId).exportPatchPath;
  await ensureCleanGitWorkingTree(projectRoot);

  if (!winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the git revision needed for working-tree materialization.`,
    );
  }

  const previousState = await captureGitExportState(projectRoot);
  if (previousState.currentRevision !== winner.baseRevision) {
    throw new OraculumError(
      `Cannot materialize candidate "${winner.id}" into the working tree because the current HEAD (${previousState.currentRevision}) no longer matches its recorded base revision (${winner.baseRevision}).`,
    );
  }

  const patch = await generateWorkspacePatch(
    projectRoot,
    winner.workspaceDir,
    winner.baseRevision,
    managedTreeRules,
  );
  if (!patch.trim()) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not have materialized working-tree changes to apply from ${winner.workspaceDir}.`,
    );
  }

  await writeTextFileAtomically(patchPath, patch);

  const apply = await runSubprocess({
    command: "git",
    args: ["apply", "--binary", patchPath],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (apply.exitCode !== 0) {
    try {
      await rollbackFailedGitApplyExport(projectRoot, previousState);
    } catch (rollbackError) {
      throw new OraculumError(
        `Failed to materialize candidate "${winner.id}" into the working tree, and rollback did not complete cleanly: ${formatUnknownError(rollbackError)}`,
      );
    }

    throw new OraculumError(
      `Failed to materialize candidate "${winner.id}" into the working tree.`,
    );
  }

  return {
    async cleanup() {},
    partialPlan: {
      patchPath,
    },
    async rollback() {
      await rollbackFailedGitApplyExport(projectRoot, previousState);
    },
  };
}

export async function materializeGitBranchExport(
  projectRoot: string,
  plan: ExportPlan,
  winner: CandidateManifest,
  managedTreeRules: ManagedTreeRules,
): Promise<MaterializationOutcome> {
  const store = new RunStore(projectRoot);
  const branchName = requireGitBranchName(plan);
  const patchPath =
    getExportMaterializationPatchPath(plan) ?? store.getRunPaths(plan.runId).exportPatchPath;
  await ensureCleanGitWorkingTree(projectRoot);
  await ensureBranchDoesNotExist(projectRoot, branchName);

  if (!winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record the git revision needed for branch materialization.`,
    );
  }

  const previousState = await captureGitExportState(projectRoot);
  if (previousState.currentRevision !== winner.baseRevision) {
    throw new OraculumError(
      `Cannot materialize candidate "${winner.id}" onto a branch because the current HEAD (${previousState.currentRevision}) no longer matches its recorded base revision (${winner.baseRevision}).`,
    );
  }

  const patch = await generateWorkspacePatch(
    projectRoot,
    winner.workspaceDir,
    winner.baseRevision,
    managedTreeRules,
  );
  if (!patch.trim()) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not have materialized branch changes to apply from ${winner.workspaceDir}.`,
    );
  }

  await writeTextFileAtomically(patchPath, patch);

  const checkout = await runSubprocess({
    command: "git",
    args: ["checkout", "-b", branchName],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (checkout.exitCode !== 0) {
    throw new OraculumError(`Failed to create target branch "${branchName}" for crowning.`);
  }

  const apply = await runSubprocess({
    command: "git",
    args: ["apply", "--binary", patchPath],
    cwd: projectRoot,
    timeoutMs: 30_000,
  });
  if (apply.exitCode !== 0) {
    try {
      await rollbackFailedGitBranchExport(projectRoot, branchName, previousState);
    } catch (rollbackError) {
      throw new OraculumError(
        `Failed to materialize candidate "${winner.id}" onto branch "${branchName}", and rollback did not complete cleanly: ${formatUnknownError(rollbackError)}`,
      );
    }

    throw new OraculumError(
      `Failed to materialize candidate "${winner.id}" onto branch "${branchName}".`,
    );
  }

  return {
    async cleanup() {},
    partialPlan: {
      patchPath,
    },
    async rollback() {
      await rollbackFailedGitBranchExport(projectRoot, branchName, previousState);
    },
  };
}
