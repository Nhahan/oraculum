import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { OraculumError } from "../core/errors.js";
import {
  getCandidateDir,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateTaskPacketPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
  getConfigPath,
  getExportPatchPath,
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getGeneratedTasksDir,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getReportsDir,
  getRunDir,
  getRunManifestPath,
  getWinnerSelectionPath,
  getWorkspaceDir,
  resolveProjectRoot,
} from "../core/paths.js";
import type { Adapter, ProjectConfig, Strategy } from "../domain/config.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  type ExportPlan,
  exportPlanSchema,
  latestRunStateSchema,
  type RunManifest,
  type RunRound,
  runManifestSchema,
} from "../domain/run.js";
import { loadProjectConfig, pathExists, writeJsonFile } from "./project.js";
import { loadTaskPacket } from "./task-packets.js";

interface PlanRunOptions {
  cwd: string;
  taskInput: string;
  agent?: Adapter;
  candidates?: number;
}

interface BuildExportPlanOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName: string;
  withReport: boolean;
}

export async function planRun(options: PlanRunOptions): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const config = await loadProjectConfig(projectRoot);
  const resolvedTaskPath = await materializeTaskInput(projectRoot, options.taskInput);

  if (!(await pathExists(getConfigPath(projectRoot)))) {
    throw new OraculumError(`Missing project config in ${projectRoot}. Run "oraculum init" first.`);
  }

  if (!(await pathExists(resolvedTaskPath))) {
    throw new OraculumError(`Task file not found: ${resolvedTaskPath}`);
  }

  const taskPacket = await loadTaskPacket(resolvedTaskPath);
  const agent = options.agent ?? config.defaultAgent;
  if (!config.adapters.includes(agent)) {
    throw new OraculumError(`Agent "${agent}" is not enabled in the project config.`);
  }

  const candidateCount = options.candidates ?? config.defaultCandidates;
  if (candidateCount < 1) {
    throw new OraculumError("Candidate count must be at least 1.");
  }

  const runId = createRunId();
  const runDir = getRunDir(projectRoot, runId);
  const reportsDir = getReportsDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const strategies = selectStrategies(config, candidateCount);
  const createdAt = new Date().toISOString();

  const candidates = await Promise.all(
    strategies.map(async (strategy, index) => {
      const candidateId = `cand-${String(index + 1).padStart(2, "0")}`;
      const candidateDir = getCandidateDir(projectRoot, runId, candidateId);
      const taskPacketPath = getCandidateTaskPacketPath(projectRoot, runId, candidateId);
      const workspaceDir = getWorkspaceDir(projectRoot, runId, candidateId);
      const verdictsDir = getCandidateVerdictsDir(projectRoot, runId, candidateId);
      const witnessesDir = getCandidateWitnessesDir(projectRoot, runId, candidateId);
      const logsDir = getCandidateLogsDir(projectRoot, runId, candidateId);

      await mkdir(candidateDir, { recursive: true });
      await mkdir(workspaceDir, { recursive: true });
      await mkdir(verdictsDir, { recursive: true });
      await mkdir(witnessesDir, { recursive: true });
      await mkdir(logsDir, { recursive: true });
      await writeJsonFile(taskPacketPath, taskPacket);

      const candidate: CandidateManifest = {
        id: candidateId,
        strategyId: strategy.id,
        strategyLabel: strategy.label,
        status: "planned",
        workspaceDir,
        taskPacketPath,
        createdAt,
      };

      candidateManifestSchema.parse(candidate);
      await writeJsonFile(getCandidateManifestPath(projectRoot, runId, candidateId), candidate);

      return candidate;
    }),
  );

  const manifest: RunManifest = {
    id: runId,
    status: "planned",
    taskPath: resolvedTaskPath,
    taskPacket: {
      id: taskPacket.id,
      title: taskPacket.title,
      sourceKind: taskPacket.source.kind,
      sourcePath: taskPacket.source.path,
    },
    agent,
    candidateCount,
    createdAt,
    rounds: config.rounds.map<RunRound>((round) => ({
      id: round.id,
      label: round.label,
      status: "pending",
      verdictCount: 0,
      survivorCount: 0,
      eliminatedCount: 0,
    })),
    candidates,
  };

  runManifestSchema.parse(manifest);
  await writeJsonFile(getRunManifestPath(projectRoot, runId), manifest);

  return manifest;
}

export async function readRunManifest(cwd: string, runId: string): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(cwd);
  const manifestPath = getRunManifestPath(projectRoot, runId);

  if (!(await pathExists(manifestPath))) {
    throw new OraculumError(`Run manifest not found: ${manifestPath}`);
  }

  const raw = await readFile(manifestPath, "utf8");
  return runManifestSchema.parse(JSON.parse(raw) as unknown);
}

export async function buildExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const resolvedRunId = options.runId ?? (await readLatestExportableRunId(projectRoot));
  const manifest = await readRunManifest(projectRoot, resolvedRunId);
  const resolvedWinnerId = options.winnerId ?? manifest.recommendedWinner?.candidateId;
  if (!resolvedWinnerId) {
    throw new OraculumError(
      `Consultation "${manifest.id}" does not have a recommended promotion. Pass a candidate id explicitly.`,
    );
  }

  const winner = manifest.candidates.find((candidate) => candidate.id === resolvedWinnerId);

  if (!winner) {
    throw new OraculumError(
      `Candidate "${resolvedWinnerId}" does not exist in run "${resolvedRunId}".`,
    );
  }
  if (winner.status !== "promoted" && winner.status !== "exported") {
    throw new OraculumError(
      `Candidate "${winner.id}" is not exportable because its status is "${winner.status}".`,
    );
  }

  if (!winner.workspaceMode) {
    throw new OraculumError(
      `Candidate "${winner.id}" does not have a materialized workspace mode. Run the candidate before exporting it.`,
    );
  }

  const reportFiles = options.withReport ? await collectReportFiles(projectRoot, manifest.id) : [];
  const mode = winner.workspaceMode === "git-worktree" ? "git-branch" : "workspace-sync";
  if (mode === "git-branch" && !winner.baseRevision) {
    throw new OraculumError(
      `Candidate "${winner.id}" was produced by an older run artifact that does not record its git base revision. Re-run the task before exporting it.`,
    );
  }

  if (mode === "workspace-sync" && !winner.baseSnapshotPath) {
    throw new OraculumError(
      `Candidate "${winner.id}" was produced by an older run artifact that does not record its base snapshot. Re-run the task before exporting it.`,
    );
  }

  const plan: ExportPlan = {
    runId: manifest.id,
    winnerId: winner.id,
    branchName: options.branchName,
    mode,
    workspaceDir: winner.workspaceDir,
    ...(mode === "git-branch" ? { patchPath: getExportPatchPath(projectRoot, manifest.id) } : {}),
    withReport: options.withReport,
    ...(options.withReport && reportFiles.length > 0
      ? {
          reportBundle: {
            rootDir: getReportsDir(projectRoot, manifest.id),
            files: reportFiles,
          },
        }
      : {}),
    createdAt: new Date().toISOString(),
  };

  exportPlanSchema.parse(plan);

  const planPath = getExportPlanPath(projectRoot, manifest.id);
  await mkdir(getReportsDir(projectRoot, manifest.id), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  return { plan, path: planPath };
}

export async function readLatestRunManifest(cwd: string): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(cwd);
  return readRunManifest(projectRoot, await readLatestRunId(projectRoot));
}

export async function readLatestRunId(cwd: string): Promise<string> {
  const projectRoot = resolveProjectRoot(cwd);
  const latestRunStatePath = getLatestRunStatePath(projectRoot);

  if (!(await pathExists(latestRunStatePath))) {
    throw new OraculumError("No previous consultation found. Start with `oraculum consult ...`.");
  }

  const raw = await readFile(latestRunStatePath, "utf8");
  const parsed = latestRunStateSchema.parse(JSON.parse(raw) as unknown);
  return parsed.runId;
}

export async function readLatestExportableRunId(cwd: string): Promise<string> {
  const projectRoot = resolveProjectRoot(cwd);
  const latestRunStatePath = getLatestExportableRunStatePath(projectRoot);

  if (!(await pathExists(latestRunStatePath))) {
    throw new OraculumError(
      "No exportable consultation found yet. Complete a consultation with a recommended promotion first.",
    );
  }

  const raw = await readFile(latestRunStatePath, "utf8");
  const parsed = latestRunStateSchema.parse(JSON.parse(raw) as unknown);
  return parsed.runId;
}

function createRunId(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = randomUUID().slice(0, 8);
  return `run_${timestamp}_${suffix}`;
}

function selectStrategies(config: ProjectConfig, candidateCount: number): Strategy[] {
  return Array.from({ length: candidateCount }, (_, index) => {
    const strategy = config.strategies[index % config.strategies.length];
    if (!strategy) {
      throw new OraculumError("No candidate strategies are configured.");
    }

    if (index < config.strategies.length) {
      return strategy;
    }

    return {
      ...strategy,
      id: `${strategy.id}-${index + 1}`,
      label: `${strategy.label} ${index + 1}`,
    };
  });
}

async function materializeTaskInput(projectRoot: string, taskInput: string): Promise<string> {
  const normalized = taskInput.trim();
  if (!normalized) {
    throw new OraculumError("Task input must not be empty.");
  }

  const asPath = resolve(projectRoot, normalized);
  if (await pathExists(asPath)) {
    return asPath;
  }
  if (looksLikeTaskPath(normalized)) {
    throw new OraculumError(`Task file not found: ${asPath}`);
  }

  const generatedTasksDir = getGeneratedTasksDir(projectRoot);
  await mkdir(generatedTasksDir, { recursive: true });

  const inlineTaskId = createInlineTaskId(normalized);
  const inlineTaskPath = resolve(generatedTasksDir, `${inlineTaskId}.md`);
  await writeFile(inlineTaskPath, buildInlineTaskNote(normalized), "utf8");
  return inlineTaskPath;
}

async function collectReportFiles(projectRoot: string, runId: string): Promise<string[]> {
  const candidates = [
    getFinalistComparisonJsonPath(projectRoot, runId),
    getFinalistComparisonMarkdownPath(projectRoot, runId),
    getWinnerSelectionPath(projectRoot, runId),
  ];

  const existing = await Promise.all(
    candidates.map(async (path) => ((await pathExists(path)) ? path : undefined)),
  );

  return existing.filter((path): path is string => Boolean(path));
}

function buildInlineTaskNote(taskInput: string): string {
  const normalized = taskInput.trim();
  if (normalized.startsWith("# ")) {
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  }

  return `# ${buildInlineTaskTitle(normalized)}\n${normalized}\n`;
}

function buildInlineTaskTitle(taskInput: string): string {
  const firstLine = taskInput.split(/\r?\n/u)[0]?.trim() ?? "Inline task";
  const withoutTrailingPunctuation = firstLine.replace(/[.?!]+$/u, "").trim();
  if (withoutTrailingPunctuation) {
    return withoutTrailingPunctuation.slice(0, 80);
  }

  return "Inline task";
}

function createInlineTaskId(taskInput: string): string {
  const label = buildInlineTaskTitle(taskInput)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `${label || "task"}-${randomUUID().slice(0, 8)}`;
}

function looksLikeTaskPath(taskInput: string): boolean {
  return (
    taskInput.includes("/") ||
    taskInput.includes("\\") ||
    taskInput.startsWith(".") ||
    taskInput.endsWith(".md") ||
    taskInput.endsWith(".json") ||
    taskInput.endsWith(".txt")
  );
}

export async function writeLatestRunState(projectRoot: string, runId: string): Promise<void> {
  await writeJsonFile(getLatestRunStatePath(projectRoot), {
    runId,
    updatedAt: new Date().toISOString(),
  });
}

export async function writeLatestExportableRunState(
  projectRoot: string,
  runId: string,
): Promise<void> {
  await writeJsonFile(getLatestExportableRunStatePath(projectRoot), {
    runId,
    updatedAt: new Date().toISOString(),
  });
}
