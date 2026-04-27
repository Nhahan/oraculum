import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import {
  type CrownActionRequest,
  type CrownActionResponse,
  type CrownMaterialization,
  type CrownMaterializationCheck,
  crownActionRequestSchema,
  crownActionResponseSchema,
} from "../../domain/chat-native.js";
import {
  getExportMaterializationMode,
  getExportMaterializationPatchPath,
} from "../../domain/run.js";

import { materializeExport } from "../exports.js";
import { RunStore } from "../run-store.js";
import { readRunManifest } from "../runs.js";

import {
  buildArtifactAwareConsultationStatus,
  normalizeOptionalStringInput,
  resolveActionConsultationArtifacts,
} from "./shared.js";

export async function runCrownAction(input: CrownActionRequest): Promise<CrownActionResponse> {
  const request = normalizeCrownActionRequest(input);
  const result = await materializeExport({
    cwd: request.cwd,
    ...(request.materializationName ? { materializationName: request.materializationName } : {}),
    ...(request.branchName ? { branchName: request.branchName } : {}),
    withReport: request.withReport,
    ...(request.allowUnsafe ? { allowUnsafe: true } : {}),
    ...(request.consultationId ? { runId: request.consultationId } : {}),
    ...(request.candidateId ? { winnerId: request.candidateId } : {}),
  });
  const consultation = await readRunManifest(request.cwd, result.plan.runId);
  const artifacts = await resolveActionConsultationArtifacts(request.cwd, consultation);
  const materialization = await buildCrownMaterialization(request.cwd, result.plan);

  return crownActionResponseSchema.parse({
    mode: "crown",
    plan: result.plan,
    recordPath: result.path,
    materialization,
    consultation,
    status: await buildArtifactAwareConsultationStatus(consultation, artifacts),
  });
}

function normalizeCrownActionRequest(request: CrownActionRequest): CrownActionRequest {
  return crownActionRequestSchema.parse({
    ...request,
    ...(request.materializationName !== undefined
      ? { materializationName: normalizeOptionalStringInput(request.materializationName) }
      : {}),
    ...(request.branchName !== undefined
      ? { branchName: normalizeOptionalStringInput(request.branchName) }
      : {}),
  });
}

async function buildCrownMaterialization(
  cwd: string,
  plan: CrownActionResponse["plan"],
): Promise<CrownMaterialization> {
  const store = new RunStore(cwd);
  const projectRoot = store.projectRoot;
  const checks: CrownMaterializationCheck[] = [];
  let currentBranch: string | undefined;
  const materializationMode = getExportMaterializationMode(plan);

  if (materializationMode === "branch" || materializationMode === "working-tree") {
    checks.push(assertGitPatchArtifact(plan));
  }

  if (materializationMode === "branch") {
    const branchName = requireMaterializedBranchName(plan);
    currentBranch = await readVerifiedCurrentGitBranch(projectRoot, branchName);
    checks.push({
      id: "current-branch",
      status: "passed",
      summary: `Current git branch is ${currentBranch}.`,
    });
  }

  if (materializationMode === "working-tree") {
    currentBranch = await readCurrentGitBranch(projectRoot);
    if (currentBranch) {
      checks.push({
        id: "current-branch",
        status: "passed",
        summary: `Applied on current git branch ${currentBranch}.`,
      });
    }
  }

  if (materializationMode === "workspace-sync") {
    checks.push(assertWorkspaceSyncSummary(store, plan.runId));
  }

  const changedPaths = await readMaterializedChangedPaths(store, plan);
  if (changedPaths.length === 0) {
    throw new OraculumError(
      `Crowning post-check failed: no materialized changed paths were detected for ${plan.mode} export "${plan.runId}".`,
    );
  }
  checks.push({
    id: "changed-paths",
    status: "passed",
    summary: `${changedPaths.length} changed path${changedPaths.length === 1 ? "" : "s"} detected.`,
  });

  const materializationLabel =
    materializationMode === "workspace-sync" || materializationMode === "working-tree"
      ? (plan.materializationLabel ?? plan.branchName)
      : undefined;
  const materializationName =
    materializationMode === "branch" ? plan.branchName : materializationLabel;

  return {
    materialized: true,
    verified: true,
    mode:
      materializationMode === "branch"
        ? "git-branch"
        : materializationMode === "working-tree"
          ? "git-apply"
          : "workspace-sync",
    materializationMode,
    ...(materializationMode === "branch" && plan.branchName ? { branchName: plan.branchName } : {}),
    ...(materializationName ? { materializationName } : {}),
    ...(materializationLabel ? { materializationLabel } : {}),
    ...(currentBranch ? { currentBranch } : {}),
    changedPaths,
    changedPathCount: changedPaths.length,
    checks,
  };
}

function requireMaterializedBranchName(plan: CrownActionResponse["plan"]): string {
  if (!plan.branchName) {
    throw new OraculumError(
      `Crowning post-check failed: git-branch export "${plan.runId}" did not record a branch name.`,
    );
  }

  return plan.branchName;
}

function assertGitPatchArtifact(plan: CrownActionResponse["plan"]): CrownMaterializationCheck {
  const patchPath = getExportMaterializationPatchPath(plan);
  if (!patchPath) {
    throw new OraculumError(
      `Crowning post-check failed: git materialization "${plan.runId}" did not record a git materialization artifact path.`,
    );
  }

  if (!existsSync(patchPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected git materialization artifact does not exist at ${patchPath}.`,
    );
  }

  return {
    id: "git-patch-artifact",
    status: "passed",
    summary: `Git materialization artifact exists at ${patchPath}.`,
  };
}

function assertWorkspaceSyncSummary(store: RunStore, runId: string): CrownMaterializationCheck {
  const syncSummaryPath = store.getRunPaths(runId).exportSyncSummaryPath;
  if (!existsSync(syncSummaryPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected workspace-sync summary does not exist at ${syncSummaryPath}.`,
    );
  }

  return {
    id: "workspace-sync-summary",
    status: "passed",
    summary: `Workspace-sync summary exists at ${syncSummaryPath}.`,
  };
}

async function readVerifiedCurrentGitBranch(
  projectRoot: string,
  expectedBranch: string,
): Promise<string> {
  const currentBranch = await readCurrentGitBranch(projectRoot);
  if (!currentBranch) {
    throw new OraculumError(
      `Crowning post-check failed: could not determine the current git branch in ${projectRoot}.`,
    );
  }

  if (currentBranch !== expectedBranch) {
    throw new OraculumError(
      `Crowning post-check failed: expected current git branch "${expectedBranch}", received "${currentBranch}".`,
    );
  }

  return currentBranch;
}

async function readCurrentGitBranch(projectRoot: string): Promise<string | undefined> {
  const result = await runSubprocess({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: projectRoot,
    timeoutMs: 10_000,
  }).catch(() => undefined);
  if (!result) {
    return undefined;
  }

  const branch = result.stdout.trim();
  return result.exitCode === 0 && branch.length > 0 ? branch : undefined;
}

async function readMaterializedChangedPaths(
  store: RunStore,
  plan: CrownActionResponse["plan"],
): Promise<string[]> {
  if (
    getExportMaterializationMode(plan) === "branch" ||
    getExportMaterializationMode(plan) === "working-tree"
  ) {
    const patchPath = getExportMaterializationPatchPath(plan);
    if (!patchPath) {
      throw new OraculumError(
        `Crowning post-check failed: git materialization "${plan.runId}" did not record a git materialization artifact path.`,
      );
    }

    try {
      return parseGitPatchChangedPaths(await readFile(patchPath, "utf8"));
    } catch (error) {
      throw new OraculumError(
        `Crowning post-check failed: could not read git materialization artifact at ${patchPath}: ${formatUnknownError(error)}`,
      );
    }
  }

  const syncSummaryPath = store.getRunPaths(plan.runId).exportSyncSummaryPath;
  if (!existsSync(syncSummaryPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected workspace-sync summary does not exist at ${syncSummaryPath}.`,
    );
  }

  try {
    const parsed = JSON.parse(await readFile(syncSummaryPath, "utf8")) as {
      appliedFiles?: unknown;
      removedFiles?: unknown;
    };
    return uniqueSortedStrings([
      ...(Array.isArray(parsed.appliedFiles) ? parsed.appliedFiles : []),
      ...(Array.isArray(parsed.removedFiles) ? parsed.removedFiles : []),
    ]);
  } catch (error) {
    throw new OraculumError(
      `Crowning post-check failed: could not read workspace-sync summary at ${syncSummaryPath}: ${formatUnknownError(error)}`,
    );
  }
}

function parseGitPatchChangedPaths(patch: string): string[] {
  const paths: string[] = [];
  let oldPath: string | undefined;

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("--- ")) {
      oldPath = normalizePatchPath(line.slice(4));
      continue;
    }

    if (!line.startsWith("+++ ")) {
      continue;
    }

    const newPath = normalizePatchPath(line.slice(4));
    paths.push(...[oldPath, newPath].filter((value): value is string => Boolean(value)));
    oldPath = undefined;
  }

  return uniqueSortedStrings(paths);
}

function normalizePatchPath(value: string): string | undefined {
  const [path] = value.trim().split(/\t/u);
  if (!path) {
    return undefined;
  }

  if (path === "/dev/null") {
    return undefined;
  }

  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }

  return path.length > 0 ? path : undefined;
}

function uniqueSortedStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
