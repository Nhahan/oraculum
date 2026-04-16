import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import {
  type CrownMaterialization,
  type CrownMaterializationCheck,
  type CrownToolRequest,
  type CrownToolResponse,
  crownToolRequestSchema,
  crownToolResponseSchema,
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
  resolveToolConsultationArtifacts,
} from "./shared.js";

export async function runCrownTool(input: CrownToolRequest): Promise<CrownToolResponse> {
  const request = normalizeCrownToolRequest(input);
  const result = await materializeExport({
    cwd: request.cwd,
    ...(request.branchName ? { branchName: request.branchName } : {}),
    ...(request.materializationLabel ? { materializationLabel: request.materializationLabel } : {}),
    withReport: request.withReport,
    ...(request.consultationId ? { runId: request.consultationId } : {}),
    ...(request.candidateId ? { winnerId: request.candidateId } : {}),
  });
  const consultation = await readRunManifest(request.cwd, result.plan.runId);
  const artifacts = await resolveToolConsultationArtifacts(request.cwd, consultation);
  const materialization = await buildCrownMaterialization(request.cwd, result.plan);

  return crownToolResponseSchema.parse({
    mode: "crown",
    plan: result.plan,
    recordPath: result.path,
    materialization,
    consultation,
    status: await buildArtifactAwareConsultationStatus(consultation, artifacts),
  });
}

function normalizeCrownToolRequest(request: CrownToolRequest): CrownToolRequest {
  return crownToolRequestSchema.parse({
    ...request,
    ...(request.branchName !== undefined
      ? { branchName: normalizeOptionalStringInput(request.branchName) }
      : {}),
    ...(request.materializationName !== undefined
      ? { materializationName: normalizeOptionalStringInput(request.materializationName) }
      : {}),
    ...(request.materializationLabel !== undefined
      ? { materializationLabel: normalizeOptionalStringInput(request.materializationLabel) }
      : {}),
  });
}

async function buildCrownMaterialization(
  cwd: string,
  plan: CrownToolResponse["plan"],
): Promise<CrownMaterialization> {
  const store = new RunStore(cwd);
  const projectRoot = store.projectRoot;
  const checks: CrownMaterializationCheck[] = [];
  let currentBranch: string | undefined;
  const materializationMode = getExportMaterializationMode(plan);

  if (materializationMode === "branch") {
    const branchName = requireMaterializedBranchName(plan);
    checks.push(assertGitPatchArtifact(plan));
    currentBranch = await readVerifiedCurrentGitBranch(projectRoot, branchName);
    checks.push({
      id: "current-branch",
      status: "passed",
      summary: `Current git branch is ${currentBranch}.`,
    });
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
    materializationMode === "workspace-sync"
      ? (plan.materializationLabel ?? plan.branchName)
      : undefined;
  const materializationName =
    materializationMode === "branch" ? plan.branchName : materializationLabel;

  return {
    materialized: true,
    verified: true,
    mode: materializationMode === "branch" ? "git-branch" : "workspace-sync",
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

function requireMaterializedBranchName(plan: CrownToolResponse["plan"]): string {
  if (!plan.branchName) {
    throw new OraculumError(
      `Crowning post-check failed: git-branch export "${plan.runId}" did not record a branch name.`,
    );
  }

  return plan.branchName;
}

function assertGitPatchArtifact(plan: CrownToolResponse["plan"]): CrownMaterializationCheck {
  const patchPath = getExportMaterializationPatchPath(plan);
  if (!patchPath) {
    throw new OraculumError(
      `Crowning post-check failed: branch materialization "${plan.runId}" did not record a branch materialization artifact path.`,
    );
  }

  if (!existsSync(patchPath)) {
    throw new OraculumError(
      `Crowning post-check failed: expected branch materialization artifact does not exist at ${patchPath}.`,
    );
  }

  return {
    id: "git-patch-artifact",
    status: "passed",
    summary: `Branch materialization artifact exists at ${patchPath}.`,
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
  plan: CrownToolResponse["plan"],
): Promise<string[]> {
  if (getExportMaterializationMode(plan) === "branch") {
    const patchPath = getExportMaterializationPatchPath(plan);
    if (!patchPath) {
      throw new OraculumError(
        `Crowning post-check failed: branch materialization "${plan.runId}" did not record a branch materialization artifact path.`,
      );
    }

    try {
      return parseGitPatchChangedPaths(await readFile(patchPath, "utf8"));
    } catch (error) {
      throw new OraculumError(
        `Crowning post-check failed: could not read branch materialization artifact at ${patchPath}: ${formatUnknownError(error)}`,
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
