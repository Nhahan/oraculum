import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { createAgentAdapter } from "../adapters/index.js";
import { OraculumError } from "../core/errors.js";
import {
  getCandidateDir,
  getCandidateLogsDir,
  getCandidateManifestPath,
  getCandidateTaskPacketPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
  getExportPatchPath,
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getGeneratedTasksDir,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getProfileSelectionPath,
  getReportsDir,
  getRunConfigPath,
  getRunDir,
  getRunManifestPath,
  getWinnerSelectionPath,
  getWorkspaceDir,
  resolveProjectRoot,
} from "../core/paths.js";
import type { Adapter, ProjectConfig, Strategy } from "../domain/config.js";
import { toCanonicalConsultationProfileSelection } from "../domain/profile.js";
import {
  buildBlockedPreflightOutcome,
  type CandidateManifest,
  candidateManifestSchema,
  deriveConsultationOutcomeForManifest,
  type ExportPlan,
  exportPlanSchema,
  getExportMaterializationMode,
  latestRunStateSchema,
  type RunManifest,
  type RunRound,
  runManifestSchema,
} from "../domain/run.js";
import { describeRecommendedTaskResultLabel } from "../domain/task.js";
import { recommendConsultationPreflight } from "./consultation-preflight.js";
import { recommendConsultationProfile } from "./consultation-profile.js";
import { loadProjectConfigLayers, pathExists, writeJsonFile } from "./project.js";
import { parseRunManifestArtifact } from "./run-manifest-artifact.js";
import { loadTaskPacket } from "./task-packets.js";

interface PlanRunOptions {
  cwd: string;
  taskInput: string;
  agent?: Adapter;
  candidates?: number;
  preflight?: {
    allowRuntime?: boolean;
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  };
  autoProfile?: {
    allowRuntime?: boolean;
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  };
}

interface BuildExportPlanOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName?: string;
  materializationLabel?: string;
  withReport: boolean;
}

export async function planRun(options: PlanRunOptions): Promise<RunManifest> {
  const invocationCwd = resolve(options.cwd);
  const projectRoot = resolveProjectRoot(options.cwd);
  const configLayers = await loadProjectConfigLayers(projectRoot);
  const resolvedTaskPath = await materializeTaskInput(
    projectRoot,
    invocationCwd,
    options.taskInput,
  );

  if (!(await pathExists(resolvedTaskPath))) {
    throw new OraculumError(`Task file not found: ${resolvedTaskPath}`);
  }

  const taskPacket = await loadTaskPacket(resolvedTaskPath);
  let config = configLayers.config;
  const agent = options.agent ?? config.defaultAgent;
  if (!config.adapters.includes(agent)) {
    throw new OraculumError(`Agent "${agent}" is not enabled in the project config.`);
  }
  if (options.candidates !== undefined && options.candidates > 16) {
    throw new OraculumError("Candidate count must be 16 or less.");
  }

  const runId = createRunId();
  const runDir = getRunDir(projectRoot, runId);
  const reportsDir = getReportsDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  const adapterOptions = buildAdapterFactoryOptions(options.preflight, options.autoProfile);

  const adapter =
    options.preflight || options.autoProfile
      ? createAgentAdapter(agent, adapterOptions)
      : undefined;

  const preflight = options.preflight
    ? await recommendConsultationPreflight({
        adapter:
          adapter ??
          createAgentAdapter(agent, {
            ...(options.preflight.claudeBinaryPath
              ? { claudeBinaryPath: options.preflight.claudeBinaryPath }
              : {}),
            ...(options.preflight.codexBinaryPath
              ? { codexBinaryPath: options.preflight.codexBinaryPath }
              : {}),
            ...(options.preflight.env ? { env: options.preflight.env } : {}),
            ...(options.preflight.timeoutMs !== undefined
              ? { timeoutMs: options.preflight.timeoutMs }
              : {}),
          }),
        ...(options.preflight.allowRuntime !== undefined
          ? { allowRuntime: options.preflight.allowRuntime }
          : {}),
        configLayers,
        projectRoot,
        reportsDir,
        runId,
        taskPacket,
      })
    : undefined;

  const createdAt = new Date().toISOString();
  const configPath = getRunConfigPath(projectRoot, runId);
  await writeJsonFile(configPath, config);

  if (preflight && preflight.preflight.decision !== "proceed") {
    const manifest: RunManifest = {
      id: runId,
      status: "completed",
      taskPath: resolvedTaskPath,
      taskPacket: {
        id: taskPacket.id,
        title: taskPacket.title,
        sourceKind: taskPacket.source.kind,
        sourcePath: taskPacket.source.path,
        ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
        ...(taskPacket.targetArtifactPath
          ? { targetArtifactPath: taskPacket.targetArtifactPath }
          : {}),
        ...(taskPacket.researchContext ? { researchContext: taskPacket.researchContext } : {}),
        ...(taskPacket.source.originKind && taskPacket.source.originPath
          ? {
              originKind: taskPacket.source.originKind,
              originPath: taskPacket.source.originPath,
            }
          : {}),
      },
      agent,
      configPath,
      candidateCount: 0,
      createdAt,
      updatedAt: createdAt,
      rounds: [],
      candidates: [],
      preflight: preflight.preflight,
      outcome: buildBlockedPreflightOutcome(preflight.preflight),
    };

    runManifestSchema.parse(manifest);
    await writeJsonFile(getRunManifestPath(projectRoot, runId), manifest);
    return manifest;
  }

  const autoProfile = options.autoProfile
    ? await recommendConsultationProfile({
        adapter:
          adapter ??
          createAgentAdapter(agent, {
            ...(options.autoProfile.claudeBinaryPath
              ? { claudeBinaryPath: options.autoProfile.claudeBinaryPath }
              : {}),
            ...(options.autoProfile.codexBinaryPath
              ? { codexBinaryPath: options.autoProfile.codexBinaryPath }
              : {}),
            ...(options.autoProfile.env ? { env: options.autoProfile.env } : {}),
            ...(options.autoProfile.timeoutMs !== undefined
              ? { timeoutMs: options.autoProfile.timeoutMs }
              : {}),
          }),
        ...(options.autoProfile.allowRuntime !== undefined
          ? { allowRuntime: options.autoProfile.allowRuntime }
          : {}),
        baseConfig: config,
        configLayers,
        projectRoot,
        reportsDir,
        runId,
        ...(preflight ? { signals: preflight.signals } : {}),
        taskPacket,
      })
    : undefined;
  if (autoProfile) {
    config = autoProfile.config;
  }

  const candidateCount = options.candidates ?? config.defaultCandidates;
  if (candidateCount < 1) {
    throw new OraculumError("Candidate count must be at least 1.");
  }
  if (candidateCount > 16) {
    throw new OraculumError("Candidate count must be 16 or less.");
  }

  const strategies = selectStrategies(config, candidateCount);
  const profileSelection = autoProfile
    ? {
        ...autoProfile.selection,
        candidateCount,
        strategyIds: strategies.map((strategy) => strategy.id),
        oracleIds: config.oracles.map((oracle) => oracle.id),
      }
    : undefined;
  await writeJsonFile(configPath, config);

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
        repairCount: 0,
        repairedRounds: [],
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
      ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
      ...(taskPacket.targetArtifactPath
        ? { targetArtifactPath: taskPacket.targetArtifactPath }
        : {}),
      ...(taskPacket.researchContext ? { researchContext: taskPacket.researchContext } : {}),
      ...(taskPacket.source.originKind && taskPacket.source.originPath
        ? {
            originKind: taskPacket.source.originKind,
            originPath: taskPacket.source.originPath,
          }
        : {}),
    },
    agent,
    configPath,
    candidateCount,
    createdAt,
    updatedAt: createdAt,
    rounds: config.rounds.map<RunRound>((round) => ({
      id: round.id,
      label: round.label,
      status: "pending",
      verdictCount: 0,
      survivorCount: 0,
      eliminatedCount: 0,
    })),
    candidates,
    ...(preflight ? { preflight: preflight.preflight } : {}),
    ...(profileSelection ? { profileSelection } : {}),
    outcome: deriveConsultationOutcomeForManifest({
      status: "planned",
      candidates,
      rounds: config.rounds.map<RunRound>((round) => ({
        id: round.id,
        label: round.label,
        status: "pending",
        verdictCount: 0,
        survivorCount: 0,
        eliminatedCount: 0,
      })),
      ...(profileSelection ? { profileSelection } : {}),
    }),
  };

  const persistedManifest = runManifestSchema.parse(manifest);
  await writeJsonFile(getRunManifestPath(projectRoot, runId), {
    ...persistedManifest,
    ...(persistedManifest.profileSelection
      ? {
          profileSelection: toCanonicalConsultationProfileSelection(
            persistedManifest.profileSelection,
          ),
        }
      : {}),
  });

  return manifest;
}

export async function readRunManifest(cwd: string, runId: string): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(cwd);
  const manifestPath = getRunManifestPath(projectRoot, runId);

  if (!(await pathExists(manifestPath))) {
    throw new OraculumError(`Consultation record not found: ${manifestPath}`);
  }

  const raw = await readFile(manifestPath, "utf8");
  return parseRunManifestArtifact(JSON.parse(raw) as unknown);
}

export async function buildExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const prepared = await prepareExportPlan(options);
  await mkdir(getReportsDir(resolveProjectRoot(options.cwd), prepared.plan.runId), {
    recursive: true,
  });
  await writeFile(prepared.path, `${JSON.stringify(prepared.plan, null, 2)}\n`, "utf8");

  return prepared;
}

export async function prepareExportPlan(
  options: BuildExportPlanOptions,
): Promise<{ plan: ExportPlan; path: string }> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const resolvedRunId =
    options.runId ??
    (options.winnerId
      ? await readLatestRunId(projectRoot)
      : await readLatestExportableRunId(projectRoot));
  const manifest = await readRunManifest(projectRoot, resolvedRunId);
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
          patchPath: getExportPatchPath(projectRoot, manifest.id),
          materializationPatchPath: getExportPatchPath(projectRoot, manifest.id),
        }
      : {}),
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
  return { plan, path: planPath };
}

function toDisplayPath(projectRoot: string, targetPath: string): string {
  if (!isAbsolute(targetPath)) {
    return targetPath.replaceAll("\\", "/");
  }

  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  if (display.length === 0) {
    return ".";
  }

  if (display === ".." || display.startsWith("../") || isAbsolute(display)) {
    return targetPath.replaceAll("\\", "/");
  }

  return display;
}

export async function readLatestRunManifest(cwd: string): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(cwd);
  return readRunManifest(projectRoot, await readLatestRunId(projectRoot));
}

export async function readLatestRunId(cwd: string): Promise<string> {
  const projectRoot = resolveProjectRoot(cwd);
  const latestRunStatePath = getLatestRunStatePath(projectRoot);

  if (!(await pathExists(latestRunStatePath))) {
    throw new OraculumError(
      "No previous consultation found. Start with `orc consult ...` after setup.",
    );
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
      "No crownable consultation found yet. Complete a consultation with a recommended result first.",
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

async function materializeTaskInput(
  projectRoot: string,
  invocationCwd: string,
  taskInput: string,
): Promise<string> {
  const normalized = taskInput.trim();
  if (!normalized) {
    throw new OraculumError("Task input must not be empty.");
  }

  const invocationPath = resolve(invocationCwd, normalized);
  if (await pathExists(invocationPath)) {
    return invocationPath;
  }

  const projectPath = resolve(projectRoot, normalized);
  if (projectPath !== invocationPath && (await pathExists(projectPath))) {
    return projectPath;
  }
  if (looksLikeTaskPath(normalized)) {
    throw new OraculumError(`Task file not found: ${invocationPath}`);
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
    getProfileSelectionPath(projectRoot, runId),
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
  if (/[\r\n]/u.test(taskInput)) {
    return false;
  }

  const hasWhitespace = /\s/u.test(taskInput);
  if (/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)/u.test(taskInput)) {
    return true;
  }

  return taskInput.startsWith(".") || (!hasWhitespace && extname(taskInput).length > 0);
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

function buildAdapterFactoryOptions(
  preflight: PlanRunOptions["preflight"],
  autoProfile: PlanRunOptions["autoProfile"],
): {
  claudeBinaryPath?: string;
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
} {
  const options: {
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {};

  const claudeBinaryPath = preflight?.claudeBinaryPath ?? autoProfile?.claudeBinaryPath;
  const codexBinaryPath = preflight?.codexBinaryPath ?? autoProfile?.codexBinaryPath;
  const env = preflight?.env ?? autoProfile?.env;
  const timeoutMs = preflight?.timeoutMs ?? autoProfile?.timeoutMs;

  if (claudeBinaryPath) {
    options.claudeBinaryPath = claudeBinaryPath;
  }
  if (codexBinaryPath) {
    options.codexBinaryPath = codexBinaryPath;
  }
  if (env) {
    options.env = env;
  }
  if (timeoutMs !== undefined) {
    options.timeoutMs = timeoutMs;
  }

  return options;
}
