import { createHash, randomUUID } from "node:crypto";
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
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
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
import {
  type Adapter,
  type ProjectConfig,
  projectConfigSchema,
  type Strategy,
} from "../domain/config.js";
import {
  type ConsultationProfileSelection,
  toCanonicalConsultationProfileSelection,
} from "../domain/profile.js";
import {
  buildBlockedPreflightOutcome,
  type CandidateManifest,
  type ConsultationClarifyFollowUp,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  consultationPlanArtifactSchema,
  deriveConsultationOutcomeForManifest,
  type ExportPlan,
  exportPlanSchema,
  getExportMaterializationMode,
  latestRunStateSchema,
  type RunManifest,
  type RunRound,
  runManifestSchema,
} from "../domain/run.js";
import { describeRecommendedTaskResultLabel, type MaterializedTaskPacket } from "../domain/task.js";
import { recommendConsultationPreflight } from "./consultation-preflight.js";
import { recommendConsultationProfile } from "./consultation-profile.js";
import { loadProjectConfigLayers, pathExists, writeJsonFile } from "./project.js";
import { parseRunManifestArtifact } from "./run-manifest-artifact.js";
import { loadTaskPacket, readConsultationPlanArtifact } from "./task-packets.js";

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
  const runDir = getRunDir(projectRoot, runId);
  const reportsDir = getReportsDir(projectRoot, runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
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
  const configPath = getRunConfigPath(projectRoot, runId);
  await writeJsonFile(configPath, config);

  if (preflight && preflight.decision !== "proceed") {
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
      preflight,
      outcome: buildBlockedPreflightOutcome(preflight),
    };

    runManifestSchema.parse(manifest);
    await writeJsonFile(getRunManifestPath(projectRoot, runId), manifest);
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
    ...(preflight ? { preflight } : {}),
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

function applyConsultationPlanPreset(options: {
  baseConfig: ProjectConfig;
  consultationPlan: ConsultationPlanArtifact;
  requestedCandidateCount?: number;
}): ProjectConfig {
  const candidateCount = resolveConsultationPlanCandidateCount(
    options.consultationPlan,
    options.requestedCandidateCount,
  );
  const rounds = resolveConsultationPlanRounds(options.baseConfig, options.consultationPlan);
  const strategies = resolveConsultationPlanStrategies(
    options.baseConfig,
    options.consultationPlan,
    candidateCount,
  );
  const oracles = resolveConsultationPlanOracles(
    options.baseConfig,
    options.consultationPlan,
    rounds,
  );

  assertConsultationPlanProfileSelectionConsistency(options.consultationPlan, {
    candidateCount,
    oracleIds: oracles.map((oracle) => oracle.id),
    strategyIds: strategies.map((strategy) => strategy.id),
  });
  assertConsultationPlanExecutionGraphConsistency(options.consultationPlan, {
    availableOracleIds: options.baseConfig.oracles.map((oracle) => oracle.id),
    roundIds: rounds.map((round) => round.id),
  });

  return projectConfigSchema.parse({
    ...options.baseConfig,
    defaultCandidates: candidateCount,
    strategies,
    rounds,
    oracles,
  });
}

function resolveConsultationPlanCandidateCount(
  consultationPlan: ConsultationPlanArtifact,
  requestedCandidateCount: number | undefined,
): number {
  if (consultationPlan.candidateCount < 1) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" is not ready for execution because it does not bind any candidates.`,
    );
  }

  if (
    requestedCandidateCount !== undefined &&
    requestedCandidateCount !== consultationPlan.candidateCount
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" binds candidateCount=${consultationPlan.candidateCount}; rerun the plan instead of overriding --candidates to ${requestedCandidateCount}.`,
    );
  }

  return consultationPlan.candidateCount;
}

function resolveConsultationPlanRounds(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
): ProjectConfig["rounds"] {
  if (consultationPlan.roundOrder.length === 0) {
    return config.rounds;
  }

  const roundsById = new Map(config.rounds.map((round) => [round.id, round]));
  const seen = new Set<string>();
  const rounds: ProjectConfig["rounds"] = [];

  for (const plannedRound of consultationPlan.roundOrder) {
    if (seen.has(plannedRound.id)) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" repeats round "${plannedRound.id}". Refresh the plan and rerun.`,
      );
    }
    seen.add(plannedRound.id);

    const round = roundsById.get(plannedRound.id);
    if (!round) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references round "${plannedRound.id}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }
    rounds.push(round);
  }

  return rounds;
}

function resolveConsultationPlanStrategies(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
  candidateCount: number,
): Strategy[] {
  if (consultationPlan.plannedStrategies.length > 0) {
    if (consultationPlan.plannedStrategies.length !== candidateCount) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" records ${consultationPlan.plannedStrategies.length} planned strategies but candidateCount=${candidateCount}. Refresh the plan and rerun.`,
      );
    }

    return consultationPlan.plannedStrategies.map((strategy) => {
      const existing = config.strategies.find((candidate) => candidate.id === strategy.id);
      return {
        id: strategy.id,
        label: strategy.label,
        description: existing?.description ?? `Planned consultation strategy: ${strategy.label}.`,
      };
    });
  }

  const plannedStrategyIds = consultationPlan.profileSelection?.strategyIds ?? [];
  if (plannedStrategyIds.length === 0) {
    return selectStrategies(config, candidateCount);
  }

  const strategiesById = new Map(config.strategies.map((strategy) => [strategy.id, strategy]));
  const strategies: Strategy[] = [];
  const seen = new Set<string>();

  for (const strategyId of plannedStrategyIds) {
    if (seen.has(strategyId)) {
      continue;
    }
    seen.add(strategyId);

    const strategy = strategiesById.get(strategyId);
    if (!strategy) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references strategy "${strategyId}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }
    strategies.push(strategy);
  }

  if (strategies.length === 0) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" did not resolve any executable strategies. Refresh the plan and rerun.`,
    );
  }

  return strategies;
}

function resolveConsultationPlanOracles(
  config: ProjectConfig,
  consultationPlan: ConsultationPlanArtifact,
  rounds: ProjectConfig["rounds"],
): ProjectConfig["oracles"] {
  const allowedRoundIds = new Set(rounds.map((round) => round.id));
  const selectedOracleIds =
    consultationPlan.oracleIds.length > 0
      ? consultationPlan.oracleIds
      : (consultationPlan.profileSelection?.oracleIds ?? []);

  if (selectedOracleIds.length === 0) {
    return config.oracles.filter((oracle) => allowedRoundIds.has(oracle.roundId));
  }

  const selected: ProjectConfig["oracles"] = [];
  const seen = new Set<string>();

  for (const oracleId of selectedOracleIds) {
    const matches = config.oracles.filter(
      (oracle) => oracle.id === oracleId && allowedRoundIds.has(oracle.roundId),
    );
    if (matches.length === 0) {
      throw new OraculumError(
        `Persisted consultation plan "${consultationPlan.runId}" references oracle "${oracleId}" that is not available in the current project config. Refresh the plan and rerun.`,
      );
    }

    for (const oracle of matches) {
      const key = `${oracle.roundId}:${oracle.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      selected.push(oracle);
    }
  }

  return selected;
}

function assertConsultationPlanProfileSelectionConsistency(
  consultationPlan: ConsultationPlanArtifact,
  options: {
    candidateCount: number;
    oracleIds: string[];
    strategyIds: string[];
  },
): void {
  if (!consultationPlan.profileSelection) {
    return;
  }

  if (consultationPlan.profileSelection.candidateCount !== options.candidateCount) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent profileSelection.candidateCount (${consultationPlan.profileSelection.candidateCount}) for candidateCount=${options.candidateCount}. Refresh the plan and rerun.`,
    );
  }

  if (
    consultationPlan.profileSelection.oracleIds.length > 0 &&
    !stringArraysEqual(consultationPlan.profileSelection.oracleIds, options.oracleIds)
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent oracle preset metadata. Refresh the plan and rerun.`,
    );
  }

  if (
    consultationPlan.profileSelection.strategyIds.length > 0 &&
    !stringArraysEqual(consultationPlan.profileSelection.strategyIds, options.strategyIds)
  ) {
    throw new OraculumError(
      `Persisted consultation plan "${consultationPlan.runId}" has inconsistent strategy preset metadata. Refresh the plan and rerun.`,
    );
  }
}

function assertConsultationPlanExecutionGraphConsistency(
  consultationPlan: ConsultationPlanArtifact,
  options: {
    availableOracleIds: string[];
    roundIds: ProjectConfig["rounds"][number]["id"][];
  },
): void {
  assertUniqueExecutionGraphIds(
    consultationPlan.workstreams.map((workstream) => workstream.id),
    {
      itemKind: "workstream",
      runId: consultationPlan.runId,
    },
  );
  assertUniqueExecutionGraphIds(
    consultationPlan.stagePlan.map((stage) => stage.id),
    {
      itemKind: "stage",
      runId: consultationPlan.runId,
    },
  );

  const workstreamIds = new Set(consultationPlan.workstreams.map((workstream) => workstream.id));
  const stageIds = new Set(consultationPlan.stagePlan.map((stage) => stage.id));
  const availableOracleIds = new Set(options.availableOracleIds);
  const roundIds = new Set(options.roundIds);

  for (const workstream of consultationPlan.workstreams) {
    for (const dependencyId of workstream.dependencies) {
      if (!workstreamIds.has(dependencyId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown workstream dependency "${dependencyId}" from "${workstream.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const oracleId of workstream.oracleIds) {
      if (!availableOracleIds.has(oracleId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references workstream oracle "${oracleId}" that is not available in the current project config. Refresh the plan and rerun.`,
        );
      }
    }
  }

  for (const stage of consultationPlan.stagePlan) {
    for (const dependencyId of stage.dependsOn) {
      if (!stageIds.has(dependencyId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown stage dependency "${dependencyId}" from "${stage.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const workstreamId of stage.workstreamIds) {
      if (!workstreamIds.has(workstreamId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references unknown workstream "${workstreamId}" from stage "${stage.id}". Refresh the plan and rerun.`,
        );
      }
    }
    for (const roundId of stage.roundIds) {
      if (!roundIds.has(roundId)) {
        throw new OraculumError(
          `Persisted consultation plan "${consultationPlan.runId}" references stage round "${roundId}" that is not available in the current project config. Refresh the plan and rerun.`,
        );
      }
    }
  }

  assertExecutionGraphAcyclic({
    dependencyKind: "workstream",
    edges: consultationPlan.workstreams.map((workstream) => ({
      id: workstream.id,
      dependsOn: workstream.dependencies,
    })),
    runId: consultationPlan.runId,
  });
  assertExecutionGraphAcyclic({
    dependencyKind: "stage",
    edges: consultationPlan.stagePlan.map((stage) => ({
      id: stage.id,
      dependsOn: stage.dependsOn,
    })),
    runId: consultationPlan.runId,
  });
}

function assertUniqueExecutionGraphIds(
  ids: string[],
  options: {
    itemKind: "stage" | "workstream";
    runId: string;
  },
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new OraculumError(
        `Persisted consultation plan "${options.runId}" repeats ${options.itemKind} "${id}". Refresh the plan and rerun.`,
      );
    }
    seen.add(id);
  }
}

function assertExecutionGraphAcyclic(options: {
  dependencyKind: "stage" | "workstream";
  edges: Array<{ id: string; dependsOn: string[] }>;
  runId: string;
}): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const edgesById = new Map(options.edges.map((edge) => [edge.id, edge.dependsOn]));

  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new OraculumError(
        `Persisted consultation plan "${options.runId}" contains a ${options.dependencyKind} dependency cycle through "${id}". Refresh the plan and rerun.`,
      );
    }

    visiting.add(id);
    for (const dependencyId of edgesById.get(id) ?? []) {
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const edge of options.edges) {
    visit(edge.id);
  }
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function writeConsultationPlanArtifacts(options: {
  projectRoot: string;
  runId: string;
  createdAt: string;
  taskPacket: MaterializedTaskPacket;
  candidateCount: number;
  strategies: Array<Pick<Strategy, "id" | "label">>;
  config: ProjectConfig;
  preflight?: RunManifest["preflight"];
  clarifyFollowUp?: ConsultationClarifyFollowUp;
  profileSelection?: ConsultationProfileSelection;
}): Promise<void> {
  const planPath = getConsultationPlanPath(options.projectRoot, options.runId);
  const markdownPath = getConsultationPlanMarkdownPath(options.projectRoot, options.runId);
  const planArtifact = consultationPlanArtifactSchema.parse({
    runId: options.runId,
    createdAt: options.createdAt,
    mode: "standard",
    readyForConsult:
      options.preflight?.decision !== undefined ? options.preflight.decision === "proceed" : true,
    recommendedNextAction: buildConsultationPlanNextAction(options),
    intendedResult: describeRecommendedTaskResultLabel({
      ...(options.taskPacket.artifactKind ? { artifactKind: options.taskPacket.artifactKind } : {}),
      ...(options.taskPacket.targetArtifactPath
        ? { targetArtifactPath: options.taskPacket.targetArtifactPath }
        : {}),
    }),
    decisionDrivers: buildConsultationPlanDecisionDrivers(options),
    plannedJudgingCriteria: buildConsultationPlanJudgingCriteria(options),
    crownGates: buildConsultationPlanCrownGates(options),
    openQuestions: buildConsultationPlanOpenQuestions(options),
    task: options.taskPacket,
    ...(options.preflight ? { preflight: options.preflight } : {}),
    ...(options.profileSelection ? { profileSelection: options.profileSelection } : {}),
    repoBasis: buildConsultationPlanRepoBasis(options),
    candidateCount: options.candidateCount,
    plannedStrategies: options.strategies,
    oracleIds: options.config.oracles.map((oracle) => oracle.id),
    requiredChangedPaths: options.taskPacket.targetArtifactPath
      ? [options.taskPacket.targetArtifactPath]
      : [],
    protectedPaths: [],
    roundOrder: options.config.rounds.map((round) => ({
      id: round.id,
      label: round.label,
    })),
    workstreams: buildConsultationPlanWorkstreams(options),
    stagePlan: buildConsultationPlanStagePlan(options),
    scorecardDefinition: buildConsultationPlanScorecardDefinition(options),
    repairPolicy: buildConsultationPlanRepairPolicy(options),
  });

  await writeJsonFile(planPath, planArtifact);
  await writeFile(
    markdownPath,
    `${renderConsultationPlanMarkdown(planArtifact, options.projectRoot)}\n`,
    "utf8",
  );
}

function renderConsultationPlanMarkdown(
  plan: ConsultationPlanArtifact,
  projectRoot: string,
): string {
  const lines = [
    "# Consultation Plan",
    "",
    `- Run: ${plan.runId}`,
    `- Created: ${plan.createdAt}`,
    `- Mode: ${plan.mode}`,
    `- Ready for consult: ${plan.readyForConsult ? "yes" : "no"}`,
    `- Recommended next action: ${plan.recommendedNextAction}`,
    "",
    "## Task",
    "",
    `- Title: ${plan.task.title}`,
    `- Source: ${plan.task.source.kind} (${toDisplayPath(projectRoot, plan.task.source.path)})`,
    `- Intended result: ${plan.intendedResult}`,
    "",
    "## Decision Drivers",
    "",
    ...(plan.decisionDrivers.length > 0
      ? plan.decisionDrivers.map((item) => `- ${item}`)
      : ["- No extra decision drivers were recorded."]),
    "",
    "## Planned Judging Criteria",
    "",
    ...(plan.plannedJudgingCriteria.length > 0
      ? plan.plannedJudgingCriteria.map((item) => `- ${item}`)
      : ["- No explicit judging criteria were staged."]),
    "",
    "## Crown Gates",
    "",
    ...(plan.crownGates.length > 0
      ? plan.crownGates.map((item) => `- ${item}`)
      : ["- No extra crown gates were staged."]),
    "",
    "## Planned Strategies",
    "",
    ...(plan.plannedStrategies.length > 0
      ? plan.plannedStrategies.map((strategy) => `- ${strategy.label} (${strategy.id})`)
      : ["- No candidate strategies were staged."]),
    "",
    "## Oracle Plan",
    "",
    ...(plan.oracleIds.length > 0
      ? plan.oracleIds.map((oracleId) => `- ${oracleId}`)
      : ["- No repo-local oracle ids were selected."]),
    "",
    "## Required Changed Paths",
    "",
    ...(plan.requiredChangedPaths.length > 0
      ? plan.requiredChangedPaths.map((targetPath) => `- ${targetPath}`)
      : ["- None."]),
    "",
    "## Protected Paths",
    "",
    ...(plan.protectedPaths.length > 0
      ? plan.protectedPaths.map((targetPath) => `- ${targetPath}`)
      : ["- None."]),
    "",
    "## Repo Basis",
    "",
    `- Project root: ${toDisplayPath(projectRoot, plan.repoBasis.projectRoot)}`,
    `- Signal fingerprint: ${plan.repoBasis.signalFingerprint}`,
    ...(plan.repoBasis.availableOracleIds.length > 0
      ? plan.repoBasis.availableOracleIds.map((oracleId) => `- Available oracle: ${oracleId}`)
      : ["- Available oracle ids: none"]),
    ...(plan.repoBasis.createdFromProfileId
      ? [`- Created from profile: ${plan.repoBasis.createdFromProfileId}`]
      : []),
    ...(plan.repoBasis.createdFromPreflightDecision
      ? [`- Created from preflight decision: ${plan.repoBasis.createdFromPreflightDecision}`]
      : []),
    "",
    "## Workstreams",
    "",
    ...(plan.workstreams.length > 0
      ? plan.workstreams.flatMap((workstream) => [
          `- ${workstream.label} (${workstream.id})`,
          `  - Goal: ${workstream.goal}`,
          ...(workstream.targetArtifacts.length > 0
            ? [`  - Target artifacts: ${workstream.targetArtifacts.join(", ")}`]
            : []),
          ...(workstream.requiredChangedPaths.length > 0
            ? [`  - Required changed paths: ${workstream.requiredChangedPaths.join(", ")}`]
            : []),
          ...(workstream.protectedPaths.length > 0
            ? [`  - Protected paths: ${workstream.protectedPaths.join(", ")}`]
            : []),
          ...(workstream.oracleIds.length > 0
            ? [`  - Oracle ids: ${workstream.oracleIds.join(", ")}`]
            : []),
          ...(workstream.disqualifiers.length > 0
            ? [`  - Disqualifiers: ${workstream.disqualifiers.join(" | ")}`]
            : []),
        ])
      : ["- No workstreams were staged."]),
    "",
    "## Stage Plan",
    "",
    ...(plan.stagePlan.length > 0
      ? plan.stagePlan.flatMap((stage) => [
          `- ${stage.label} (${stage.id})`,
          ...(stage.workstreamIds.length > 0
            ? [`  - Workstreams: ${stage.workstreamIds.join(", ")}`]
            : []),
          ...(stage.roundIds.length > 0 ? [`  - Rounds: ${stage.roundIds.join(", ")}`] : []),
          ...(stage.entryCriteria.length > 0
            ? [`  - Entry criteria: ${stage.entryCriteria.join(" | ")}`]
            : []),
          ...(stage.exitCriteria.length > 0
            ? [`  - Exit criteria: ${stage.exitCriteria.join(" | ")}`]
            : []),
        ])
      : ["- No staged execution plan was recorded."]),
    "",
    "## Scorecard Definition",
    "",
    ...(plan.scorecardDefinition.dimensions.length > 0
      ? plan.scorecardDefinition.dimensions.map((dimension) => `- Dimension: ${dimension}`)
      : ["- Dimensions: none"]),
    ...(plan.scorecardDefinition.abstentionTriggers.length > 0
      ? plan.scorecardDefinition.abstentionTriggers.map((trigger) => `- Abstain on: ${trigger}`)
      : ["- Abstention triggers: none"]),
    "",
    "## Repair Policy",
    "",
    `- Max attempts per stage: ${plan.repairPolicy.maxAttemptsPerStage}`,
    ...(plan.repairPolicy.immediateElimination.length > 0
      ? plan.repairPolicy.immediateElimination.map((item) => `- Immediate elimination: ${item}`)
      : ["- Immediate elimination: none"]),
    ...(plan.repairPolicy.repairable.length > 0
      ? plan.repairPolicy.repairable.map((item) => `- Repairable: ${item}`)
      : ["- Repairable: none"]),
    ...(plan.repairPolicy.preferAbstainOverRetry.length > 0
      ? plan.repairPolicy.preferAbstainOverRetry.map(
          (item) => `- Prefer abstain over retry: ${item}`,
        )
      : ["- Prefer abstain over retry: none"]),
    "",
    "## Round Order",
    "",
    ...(plan.roundOrder.length > 0
      ? plan.roundOrder.map((round) => `- ${round.label} (${round.id})`)
      : ["- No rounds were planned."]),
    "",
    "## Open Questions",
    "",
    ...(plan.openQuestions.length > 0
      ? plan.openQuestions.map((item) => `- ${item}`)
      : ["- None."]),
    "",
    "## Next Step",
    "",
    `- ${plan.recommendedNextAction}`,
  ];

  if (plan.profileSelection) {
    lines.push(
      "",
      "## Validation Posture",
      "",
      `- Profile: ${plan.profileSelection.validationProfileId}`,
      `- Confidence: ${plan.profileSelection.confidence}`,
      `- Summary: ${plan.profileSelection.validationSummary}`,
    );
  }

  if (plan.preflight) {
    lines.push(
      "",
      "## Preflight",
      "",
      `- Decision: ${plan.preflight.decision}`,
      `- Confidence: ${plan.preflight.confidence}`,
      `- Summary: ${plan.preflight.summary}`,
    );
    if (plan.preflight.clarificationQuestion) {
      lines.push(`- Clarification question: ${plan.preflight.clarificationQuestion}`);
    }
    if (plan.preflight.researchQuestion) {
      lines.push(`- Research question: ${plan.preflight.researchQuestion}`);
    }
  }

  return lines.join("\n");
}

function buildConsultationPlanRepoBasis(options: {
  projectRoot: string;
  config: ProjectConfig;
  preflight?: RunManifest["preflight"];
  profileSelection?: ConsultationProfileSelection;
  strategies: Array<Pick<Strategy, "id" | "label">>;
  taskPacket: MaterializedTaskPacket;
}) {
  const signalFingerprintInput = {
    taskId: options.taskPacket.id,
    artifactKind: options.taskPacket.artifactKind ?? null,
    targetArtifactPath: options.taskPacket.targetArtifactPath ?? null,
    strategyIds: options.strategies.map((strategy) => strategy.id),
    oracleIds: options.config.oracles.map((oracle) => oracle.id),
    roundIds: options.config.rounds.map((round) => round.id),
    validationProfileId: options.profileSelection?.validationProfileId ?? null,
    preflightDecision: options.preflight?.decision ?? null,
  };

  return {
    projectRoot: options.projectRoot,
    signalFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(signalFingerprintInput)).digest("hex")}`,
    availableOracleIds: options.config.oracles.map((oracle) => oracle.id),
    ...(options.profileSelection?.validationProfileId
      ? { createdFromProfileId: options.profileSelection.validationProfileId }
      : {}),
    ...(options.preflight?.decision
      ? { createdFromPreflightDecision: options.preflight.decision }
      : {}),
  };
}

function buildConsultationPlanWorkstreams(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  const targetArtifacts = options.taskPacket.targetArtifactPath
    ? [options.taskPacket.targetArtifactPath]
    : [];
  const requiredChangedPaths = options.taskPacket.targetArtifactPath
    ? [options.taskPacket.targetArtifactPath]
    : [];
  const disqualifiers = options.taskPacket.targetArtifactPath
    ? [
        `Do not satisfy the task without materially changing ${options.taskPacket.targetArtifactPath}.`,
      ]
    : [];

  return [
    {
      id: "primary-contract",
      label: "Primary Contract",
      goal: describeRecommendedTaskResultLabel({
        ...(options.taskPacket.artifactKind
          ? { artifactKind: options.taskPacket.artifactKind }
          : {}),
        ...(options.taskPacket.targetArtifactPath
          ? { targetArtifactPath: options.taskPacket.targetArtifactPath }
          : {}),
      }),
      targetArtifacts,
      requiredChangedPaths,
      protectedPaths: [],
      oracleIds: options.config.oracles.map((oracle) => oracle.id),
      dependencies: [],
      risks: options.taskPacket.risks,
      disqualifiers,
    },
  ];
}

function buildConsultationPlanStagePlan(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  return [
    {
      id: "primary-stage",
      label: "Primary Stage",
      dependsOn: [],
      workstreamIds: ["primary-contract"],
      roundIds: options.config.rounds.map((round) => round.id),
      entryCriteria: ["Consultation plan basis remains current."],
      exitCriteria: options.taskPacket.targetArtifactPath
        ? [`Materially change ${options.taskPacket.targetArtifactPath}.`]
        : ["Leave a materialized, reviewable result in the workspace."],
    },
  ];
}

function buildConsultationPlanScorecardDefinition(options: { taskPacket: MaterializedTaskPacket }) {
  const dimensions = new Set<string>(["oracle-pass-summary", "artifact-coherence"]);
  if (options.taskPacket.targetArtifactPath) {
    dimensions.add("target-artifact-coverage");
    dimensions.add("required-path-coverage");
  }

  return {
    dimensions: [...dimensions],
    abstentionTriggers: options.taskPacket.targetArtifactPath
      ? [`Missing target coverage for ${options.taskPacket.targetArtifactPath}.`]
      : [],
  };
}

function buildConsultationPlanRepairPolicy(options: {
  config: ProjectConfig;
  taskPacket: MaterializedTaskPacket;
}) {
  return {
    maxAttemptsPerStage: options.config.repair.enabled
      ? options.config.repair.maxAttemptsPerRound
      : 0,
    immediateElimination: [],
    repairable: options.taskPacket.targetArtifactPath ? ["missing-target-coverage"] : [],
    preferAbstainOverRetry: [],
  };
}

function buildConsultationPlanDecisionDrivers(options: {
  preflight?: RunManifest["preflight"];
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const drivers = new Set<string>();

  if (options.taskPacket.artifactKind) {
    drivers.add(`Target artifact kind: ${options.taskPacket.artifactKind}`);
  }
  if (options.taskPacket.targetArtifactPath) {
    drivers.add(`Target artifact path: ${options.taskPacket.targetArtifactPath}`);
  }
  if (options.preflight) {
    drivers.add(`Preflight posture: ${options.preflight.researchPosture}`);
    drivers.add(`Preflight decision: ${options.preflight.decision}`);
  }
  if (options.profileSelection) {
    drivers.add(`Validation posture: ${options.profileSelection.validationProfileId}`);
    for (const signal of options.profileSelection.validationSignals) {
      drivers.add(`Validation signal: ${signal}`);
    }
  }

  return [...drivers];
}

function buildConsultationPlanJudgingCriteria(options: {
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const criteria = new Set<string>();

  if (options.taskPacket.targetArtifactPath) {
    criteria.add(
      `Directly improves ${options.taskPacket.targetArtifactPath} instead of only adjacent files.`,
    );
  }
  if (options.taskPacket.artifactKind) {
    criteria.add(
      `Leaves the planned ${options.taskPacket.artifactKind} result internally consistent and reviewable.`,
    );
  }
  if (options.profileSelection?.validationProfileId) {
    criteria.add(
      `Leaves evidence strong enough for the selected ${options.profileSelection.validationProfileId} validation posture.`,
    );
  }

  return [...criteria];
}

function buildConsultationPlanCrownGates(options: {
  profileSelection?: ConsultationProfileSelection;
  taskPacket: MaterializedTaskPacket;
}): string[] {
  const gates = new Set<string>();

  if (options.taskPacket.targetArtifactPath) {
    gates.add(
      `Do not recommend finalists that fail to materially change ${options.taskPacket.targetArtifactPath}.`,
    );
  }
  if (options.taskPacket.artifactKind) {
    gates.add(
      `Abstain if no finalist leaves the planned ${options.taskPacket.artifactKind} result reviewable and internally consistent.`,
    );
  }
  if ((options.profileSelection?.validationGaps.length ?? 0) > 0) {
    gates.add(
      "Abstain when the remaining finalist evidence is too weak to overcome the selected validation gaps.",
    );
  }

  return [...gates];
}

function buildConsultationPlanOpenQuestions(options: {
  preflight?: RunManifest["preflight"];
  clarifyFollowUp?: ConsultationClarifyFollowUp;
}): string[] {
  const questions = new Set<string>();

  if (options.preflight?.clarificationQuestion) {
    questions.add(options.preflight.clarificationQuestion);
  }
  if (options.preflight?.researchQuestion) {
    questions.add(options.preflight.researchQuestion);
  }
  if (options.clarifyFollowUp?.keyQuestion) {
    questions.add(options.clarifyFollowUp.keyQuestion);
  }
  if (options.clarifyFollowUp?.missingResultContract) {
    questions.add(`Missing result contract: ${options.clarifyFollowUp.missingResultContract}`);
  }
  if (options.clarifyFollowUp?.missingJudgingBasis) {
    questions.add(`Missing judging basis: ${options.clarifyFollowUp.missingJudgingBasis}`);
  }

  return [...questions];
}

function buildConsultationPlanNextAction(options: {
  preflight?: RunManifest["preflight"];
  clarifyFollowUp?: ConsultationClarifyFollowUp;
  projectRoot: string;
  runId: string;
}): string {
  const planPath = toDisplayPath(
    options.projectRoot,
    getConsultationPlanPath(options.projectRoot, options.runId),
  );

  switch (options.preflight?.decision) {
    case "needs-clarification":
      return `Answer the clarification question, revise the task contract, and rerun \`orc plan\` or \`orc consult\`.`;
    case "external-research-required":
      return `Gather bounded external research, refresh the task contract, and rerun \`orc consult\` or \`orc plan\`.`;
    case "abstain":
      return "Revise the task scope or repository setup before rerunning the consultation.";
    case "proceed":
    case undefined:
      return `Execute the planned consultation: \`orc consult ${planPath}\`.`;
  }
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
