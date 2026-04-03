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
  getExportPlanPath,
  getReportsDir,
  getRunDir,
  getRunManifestPath,
  getWorkspaceDir,
  resolveProjectRoot,
} from "../core/paths.js";
import type { Adapter, ProjectConfig, Strategy } from "../domain/config.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  type ExportPlan,
  exportPlanSchema,
  type RunManifest,
  runManifestSchema,
} from "../domain/run.js";
import { loadProjectConfig, pathExists, writeJsonFile } from "./project.js";
import { loadTaskPacket } from "./task-packets.js";

interface PlanRunOptions {
  cwd: string;
  taskPath: string;
  agent?: Adapter;
  candidates?: number;
}

interface BuildExportPlanOptions {
  cwd: string;
  runId: string;
  winnerId: string;
  branchName: string;
  withReport: boolean;
}

export async function planRun(options: PlanRunOptions): Promise<RunManifest> {
  const projectRoot = resolveProjectRoot(options.cwd);
  const config = await loadProjectConfig(projectRoot);
  const resolvedTaskPath = resolve(projectRoot, options.taskPath);

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
    rounds: config.rounds.map((round) => ({ id: round.id, label: round.label })),
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
  const manifest = await readRunManifest(projectRoot, options.runId);
  const winner = manifest.candidates.find((candidate) => candidate.id === options.winnerId);

  if (!winner) {
    throw new OraculumError(
      `Candidate "${options.winnerId}" does not exist in run "${options.runId}".`,
    );
  }

  const plan: ExportPlan = {
    runId: manifest.id,
    winnerId: winner.id,
    branchName: options.branchName,
    withReport: options.withReport,
    createdAt: new Date().toISOString(),
  };

  exportPlanSchema.parse(plan);

  const planPath = getExportPlanPath(projectRoot, options.runId);
  await mkdir(getReportsDir(projectRoot, options.runId), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  return { plan, path: planPath };
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
