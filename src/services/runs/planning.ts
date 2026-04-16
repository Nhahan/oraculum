import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { createAgentAdapter } from "../../adapters/index.js";
import { OraculumError } from "../../core/errors.js";
import { resolveProjectRoot } from "../../core/paths.js";
import type { Adapter, ProjectConfig } from "../../domain/config.js";
import { toCanonicalConsultationProfileSelection } from "../../domain/profile.js";
import {
  buildBlockedPreflightOutcome,
  type CandidateManifest,
  candidateManifestSchema,
  deriveConsultationOutcomeForManifest,
  type RunManifest,
  type RunRound,
  runManifestSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import { recommendConsultationPreflight } from "../consultation-preflight.js";
import { recommendConsultationProfile } from "../consultation-profile.js";
import { loadProjectConfigLayers, pathExists, writeJsonFile } from "../project.js";
import { RunStore } from "../run-store.js";
import { loadTaskPacket, readConsultationPlanArtifact } from "../task-packets.js";
import { writeConsultationPlanArtifacts } from "./consultation-plan-artifacts.js";
import { applyConsultationPlanPreset } from "./consultation-plan-preset.js";
import { selectStrategies } from "./strategy-selection.js";
import { materializeTaskInput } from "./task-input.js";

interface PlanRunOptions {
  cwd: string;
  taskInput: string;
  agent?: Adapter;
  candidates?: number;
  writeConsultationPlanArtifacts?: boolean;
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

export async function planRun(options: PlanRunOptions): Promise<RunManifest> {
  const invocationCwd = resolve(options.cwd);
  const projectRoot = resolveProjectRoot(options.cwd);
  const store = new RunStore(projectRoot);
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
  const consultationPlan = await readConsultationPlanArtifact(resolvedTaskPath);
  let config = configLayers.config;
  const agent = options.agent ?? config.defaultAgent;
  if (!config.adapters.includes(agent)) {
    throw new OraculumError(`Agent "${agent}" is not enabled in the project config.`);
  }
  if (options.candidates !== undefined && options.candidates > 16) {
    throw new OraculumError("Candidate count must be 16 or less.");
  }

  const runId = createRunId();
  const runPaths = await store.ensureRunDirectories(runId);
  const reportsDir = runPaths.reportsDir;
  const adapterOptions = buildAdapterFactoryOptions(options.preflight, options.autoProfile);

  const adapter =
    options.preflight || options.autoProfile
      ? createAgentAdapter(agent, adapterOptions)
      : undefined;

  const recommendedPreflight =
    !consultationPlan && options.preflight
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
  const preflight = consultationPlan?.preflight ?? recommendedPreflight?.preflight;

  const createdAt = new Date().toISOString();
  const configPath = runPaths.configPath;
  await writeJsonFile(configPath, config);

  if (preflight && preflight.decision !== "proceed") {
    const manifest: RunManifest = {
      id: runId,
      status: "completed",
      taskPath: resolvedTaskPath,
      taskPacket: buildManifestTaskPacket(taskPacket),
      agent,
      configPath,
      candidateCount: 0,
      createdAt,
      updatedAt: createdAt,
      rounds: [],
      candidates: [],
      preflight,
      outcome: buildBlockedPreflightOutcome(preflight),
    };

    runManifestSchema.parse(manifest);
    await store.writeRunManifest(manifest);
    if (options.writeConsultationPlanArtifacts) {
      await writeConsultationPlanArtifacts({
        projectRoot,
        runId,
        createdAt,
        taskPacket,
        candidateCount: 0,
        strategies: [],
        config,
        preflight,
        ...(recommendedPreflight?.clarifyFollowUp
          ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
          : {}),
      });
    }
    return manifest;
  }

  if (consultationPlan) {
    config = applyConsultationPlanPreset({
      baseConfig: config,
      consultationPlan,
      ...(options.candidates !== undefined ? { requestedCandidateCount: options.candidates } : {}),
    });
  }

  const autoProfile =
    !consultationPlan && options.autoProfile
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
          ...(recommendedPreflight ? { signals: recommendedPreflight.signals } : {}),
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
  const profileSelection = consultationPlan?.profileSelection
    ? toCanonicalConsultationProfileSelection(consultationPlan.profileSelection)
    : autoProfile
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
      const candidatePaths = await store.ensureCandidateDirectories(runId, candidateId);
      const taskPacketPath = candidatePaths.taskPacketPath;
      const workspaceDir = candidatePaths.workspaceDir;

      await store.writeCandidateTaskPacket(runId, candidateId, taskPacket);

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
      await store.writeCandidateManifest(runId, candidate);

      return candidate;
    }),
  );

  const rounds = buildPendingRounds(config);
  const manifest: RunManifest = {
    id: runId,
    status: "planned",
    taskPath: resolvedTaskPath,
    taskPacket: buildManifestTaskPacket(taskPacket),
    agent,
    configPath,
    candidateCount,
    createdAt,
    updatedAt: createdAt,
    rounds,
    candidates,
    ...(preflight ? { preflight } : {}),
    ...(profileSelection ? { profileSelection } : {}),
    outcome: deriveConsultationOutcomeForManifest({
      status: "planned",
      candidates,
      rounds,
      ...(profileSelection ? { profileSelection } : {}),
    }),
  };

  const persistedManifest = runManifestSchema.parse(manifest);
  await store.writeRunManifest({
    ...persistedManifest,
    ...(persistedManifest.profileSelection
      ? {
          profileSelection: toCanonicalConsultationProfileSelection(
            persistedManifest.profileSelection,
          ),
        }
      : {}),
  });
  if (options.writeConsultationPlanArtifacts) {
    await writeConsultationPlanArtifacts({
      projectRoot,
      runId,
      createdAt,
      taskPacket,
      candidateCount,
      strategies,
      config,
      ...(preflight ? { preflight } : {}),
      ...(recommendedPreflight?.clarifyFollowUp
        ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
        : {}),
      ...(profileSelection
        ? { profileSelection: toCanonicalConsultationProfileSelection(profileSelection) }
        : {}),
    });
  }

  return manifest;
}

function buildManifestTaskPacket(taskPacket: MaterializedTaskPacket): RunManifest["taskPacket"] {
  return {
    id: taskPacket.id,
    title: taskPacket.title,
    sourceKind: taskPacket.source.kind,
    sourcePath: taskPacket.source.path,
    ...(taskPacket.artifactKind ? { artifactKind: taskPacket.artifactKind } : {}),
    ...(taskPacket.targetArtifactPath ? { targetArtifactPath: taskPacket.targetArtifactPath } : {}),
    ...(taskPacket.researchContext ? { researchContext: taskPacket.researchContext } : {}),
    ...(taskPacket.source.originKind && taskPacket.source.originPath
      ? {
          originKind: taskPacket.source.originKind,
          originPath: taskPacket.source.originPath,
        }
      : {}),
  };
}

function buildPendingRounds(config: ProjectConfig): RunRound[] {
  return config.rounds.map<RunRound>((round) => ({
    id: round.id,
    label: round.label,
    status: "pending",
    verdictCount: 0,
    survivorCount: 0,
    eliminatedCount: 0,
  }));
}

function createRunId(): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = randomUUID().slice(0, 8);
  return `run_${timestamp}_${suffix}`;
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
