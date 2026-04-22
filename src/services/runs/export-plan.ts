import { OraculumError } from "../../core/errors.js";
import {
  deriveConsultationOutcomeForManifest,
  type ExportPlan,
  exportPlanSchema,
  getExportMaterializationMode,
  type RunManifest,
} from "../../domain/run.js";
import { describeRecommendedTaskResultLabel } from "../../domain/task.js";
import { resolveConsultationArtifacts } from "../consultation-artifacts.js";
import { pathExists, writeJsonFile } from "../project.js";
import { RunStore } from "../run-store.js";
import { toDisplayPath } from "./display-path.js";

interface BuildExportPlanOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName?: string;
  materializationLabel?: string;
  withReport: boolean;
  allowUnsafe?: boolean;
}

export async function buildExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const store = new RunStore(options.cwd);
  const prepared = await prepareExportPlan(options);
  await store.ensureRunDirectories(prepared.plan.runId);
  await writeJsonFile(prepared.path, prepared.plan);

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

  await assertCrownSafetyGate({
    allowUnsafe: options.allowUnsafe === true,
    manifest,
    projectRoot,
  });

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
    ...(options.allowUnsafe ? { safetyOverride: "operator-allow-unsafe" } : {}),
    createdAt: new Date().toISOString(),
  };

  exportPlanSchema.parse(plan);

  const planPath = store.getRunPaths(manifest.id).exportPlanPath;
  return { plan, path: planPath };
}

export async function assertCrownSafetyGate(options: {
  allowUnsafe: boolean;
  manifest: RunManifest;
  projectRoot: string;
}): Promise<void> {
  const blockers = await collectCrownSafetyBlockers(options.projectRoot, options.manifest);
  if (blockers.length === 0 || options.allowUnsafe) {
    return;
  }

  throw new OraculumError(
    [
      `Crowning is blocked because consultation "${options.manifest.id}" is not safe to materialize:`,
      ...blockers.map((blocker) => `- ${blocker}`),
      "Use `orc crown --allow-unsafe` only after operator review confirms these blockers are acceptable.",
    ].join("\n"),
  );
}

async function collectCrownSafetyBlockers(
  projectRoot: string,
  manifest: RunManifest,
): Promise<string[]> {
  const blockers: string[] = [];
  const outcome = manifest.outcome ?? deriveConsultationOutcomeForManifest(manifest);

  if (outcome.validationGapCount > 0) {
    blockers.push(
      `${outcome.validationGapCount} validation gap${outcome.validationGapCount === 1 ? "" : "s"} remain in the selected validation posture`,
    );
  }

  if (manifest.recommendedWinner?.source === "fallback-policy") {
    blockers.push("recommended winner was selected by fallback-policy");
  }

  const artifacts = await resolveConsultationArtifacts(projectRoot, manifest.id);
  if (
    artifacts.secondOpinionWinnerSelection &&
    artifacts.secondOpinionWinnerSelection.agreement !== "agrees-select"
  ) {
    blockers.push(
      `second-opinion judge requires manual review (${artifacts.secondOpinionWinnerSelection.agreement})`,
    );
  }
  for (const diagnostic of artifacts.artifactDiagnostics) {
    if (diagnostic.kind === "winner-selection-second-opinion") {
      blockers.push(`second-opinion artifact is invalid: ${diagnostic.message}`);
    }
  }

  return blockers;
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
