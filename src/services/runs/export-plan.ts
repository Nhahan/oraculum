import { writeFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import {
  type ExportPlan,
  exportPlanSchema,
  getExportMaterializationMode,
} from "../../domain/run.js";
import { describeRecommendedTaskResultLabel } from "../../domain/task.js";
import { pathExists } from "../project.js";
import { RunStore } from "../run-store.js";
import { toDisplayPath } from "./display-path.js";

interface BuildExportPlanOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName?: string;
  materializationLabel?: string;
  withReport: boolean;
}

export async function buildExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const store = new RunStore(options.cwd);
  const prepared = await prepareExportPlan(options);
  await store.ensureRunDirectories(prepared.plan.runId);
  await writeFile(prepared.path, `${JSON.stringify(prepared.plan, null, 2)}\n`, "utf8");

  return prepared;
}

export async function prepareExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const store = new RunStore(options.cwd);
  const projectRoot = store.projectRoot;
  const resolvedRunId =
    options.runId ??
    (options.winnerId ? await store.readLatestRunId() : await store.readLatestExportableRunId());
  const manifest = await store.readRunManifest(resolvedRunId);
  const resolvedWinnerId =
    options.winnerId ??
    manifest.recommendedWinner?.candidateId ??
    manifest.outcome?.recommendedCandidateId;
  const recommendedResultLabel = describeRecommendedTaskResultLabel({
    ...(manifest.taskPacket.artifactKind ? { artifactKind: manifest.taskPacket.artifactKind } : {}),
    ...(manifest.taskPacket.targetArtifactPath
      ? {
          targetArtifactPath: toDisplayPath(projectRoot, manifest.taskPacket.targetArtifactPath),
        }
      : {}),
  });
  if (!resolvedWinnerId) {
    throw new OraculumError(
      `Consultation "${manifest.id}" does not have a ${recommendedResultLabel}. Reopen the comparison report first, or provide a candidate id explicitly through a direct tool call.`,
    );
  }

  const winner = manifest.candidates.find((candidate) => candidate.id === resolvedWinnerId);

  if (!winner) {
    throw new OraculumError(
      `Candidate "${resolvedWinnerId}" does not exist in consultation "${resolvedRunId}".`,
    );
  }
  if (winner.status !== "promoted" && winner.status !== "exported") {
    throw new OraculumError(
      `Candidate "${winner.id}" is not ready to materialize because its status is "${winner.status}".`,
    );
  }

  if (!winner.workspaceMode) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not record a crowning materialization mode. Re-run the consultation before materializing it.`,
    );
  }

  const reportFiles = options.withReport ? await collectReportFiles(projectRoot, manifest.id) : [];
  const mode = winner.workspaceMode === "git-worktree" ? "git-branch" : "workspace-sync";
  const materializationMode = getExportMaterializationMode({ mode });
  if (mode === "git-branch" && !options.branchName) {
    throw new OraculumError(
      "Branch materialization requires a target branch name. Use `orc crown <branch-name>`.",
    );
  }
  if (mode === "git-branch" && !winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" was produced by an older consultation artifact that does not record the git base revision needed for branch materialization. Re-run the consultation before materializing it.`,
    );
  }

  if (mode === "workspace-sync" && !winner.baseSnapshotPath) {
    throw new OraculumError(
      `Candidate "${winner.id}" was produced by an older consultation artifact that does not record the base snapshot needed for workspace synchronization. Re-run the consultation before materializing it.`,
    );
  }

  const plan: ExportPlan = {
    runId: manifest.id,
    winnerId: winner.id,
    mode,
    materializationMode,
    workspaceDir: winner.workspaceDir,
    ...(mode === "git-branch" ? { branchName: options.branchName } : {}),
    ...(mode === "workspace-sync"
      ? { materializationLabel: options.materializationLabel ?? options.branchName }
      : {}),
    ...(mode === "git-branch"
      ? {
          patchPath: store.getRunPaths(manifest.id).exportPatchPath,
          materializationPatchPath: store.getRunPaths(manifest.id).exportPatchPath,
        }
      : {}),
    withReport: options.withReport,
    ...(options.withReport && reportFiles.length > 0
      ? {
          reportBundle: { rootDir: store.getRunPaths(manifest.id).reportsDir, files: reportFiles },
        }
      : {}),
    createdAt: new Date().toISOString(),
  };

  exportPlanSchema.parse(plan);

  const planPath = store.getRunPaths(manifest.id).exportPlanPath;
  return { plan, path: planPath };
}

async function collectReportFiles(projectRoot: string, runId: string): Promise<string[]> {
  const runPaths = new RunStore(projectRoot).getRunPaths(runId);
  const candidates = [
    runPaths.profileSelectionPath,
    runPaths.comparisonJsonPath,
    runPaths.comparisonMarkdownPath,
    runPaths.winnerSelectionPath,
  ];

  const existing = await Promise.all(
    candidates.map(async (path) => ((await pathExists(path)) ? path : undefined)),
  );

  return existing.filter((path): path is string => Boolean(path));
}
