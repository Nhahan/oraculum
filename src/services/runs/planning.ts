import { resolve } from "node:path";

import { createAgentAdapter } from "../../adapters/index.js";
import { OraculumError } from "../../core/errors.js";
import { resolveProjectRoot } from "../../core/paths.js";
import { toCanonicalConsultationProfileSelection } from "../../domain/profile.js";
import {
  buildBlockedPreflightOutcome,
  candidateManifestSchema,
  deriveConsultationOutcomeForManifest,
  type PlanConsensusArtifact,
  type PlanningDepthArtifact,
  type PlanningInterviewArtifact,
  type PlanningSpecArtifact,
  type RunManifest,
  runManifestSchema,
} from "../../domain/run.js";
import {
  applyPlanningClarificationAnswer,
  recommendConsultationPreflight,
} from "../consultation-preflight.js";
import { recommendConsultationProfile } from "../consultation-profile.js";
import {
  buildPlanConsensus,
  summarizePlanConsensusBlocker,
  writePlanConsensusArtifact,
} from "../plan-consensus/index.js";
import {
  buildPlanningInterviewNeedingAnswer,
  classifyPlanningContinuation,
  crystallizePlanningSpecArtifact,
  findActivePlanningInterview,
  recommendPlanningDepthArtifact,
  resolvePlanningLoopCaps,
  scorePlanningInterviewAnswer,
  writePlanningInterviewArtifacts,
} from "../planning-interview/index.js";
import { loadProjectConfigLayers, pathExists, writeJsonFile } from "../project.js";
import { RunStore } from "../run-store.js";
import { loadTaskPacket, readConsultationPlanArtifact } from "../task-packets.js";
import { buildConsultationPlanArtifact } from "./consultation-plan-artifacts/build.js";
import { recommendConsultationPlanReview } from "./consultation-plan-artifacts/review.js";
import { assertConsultationPlanReadyForConsult } from "./consultation-plan-artifacts/validation.js";
import { writeConsultationPlanArtifacts } from "./consultation-plan-artifacts.js";
import { applyConsultationPlanPreset } from "./consultation-plan-preset.js";
import { buildAdapterFactoryOptions } from "./planning/adapters.js";
import { loadConsultationPlanBaseConfig } from "./planning/config.js";
import {
  buildManifestTaskPacket,
  buildPendingRounds,
  createPlannedCandidate,
} from "./planning/manifest.js";
import { createRunId } from "./planning/run-id.js";
import type { PlanRunOptions } from "./planning/types.js";
import { selectStrategies } from "./strategy-selection.js";
import { materializeTaskInput } from "./task-input.js";

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

  const taskPacket = applyPlanningClarificationAnswer(
    await loadTaskPacket(resolvedTaskPath),
    options.clarificationAnswer,
  );
  const consultationPlan = await readConsultationPlanArtifact(resolvedTaskPath);
  let config = await loadConsultationPlanBaseConfig(configLayers.config, resolvedTaskPath, {
    consultationPlanFound: Boolean(consultationPlan),
  });
  if (consultationPlan) {
    await assertConsultationPlanReadyForConsult({
      config,
      consultationPlan,
      planPath: resolvedTaskPath,
    });
  }
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
  const planningLane = options.planningLane ?? "consult-lite";
  const planningLoopCaps = resolvePlanningLoopCaps(configLayers);
  const adapterOptions = buildAdapterFactoryOptions(
    options.preflight,
    options.autoProfile,
    planningLane === "explicit-plan" ? planningLoopCaps.explicitPlanModelCallTimeoutMs : undefined,
  );

  const adapter =
    options.preflight ||
    options.autoProfile ||
    options.deliberate ||
    planningLane === "explicit-plan"
      ? createAgentAdapter(agent, adapterOptions)
      : undefined;
  let planningDepth: PlanningDepthArtifact | undefined;
  let planningInterview: PlanningInterviewArtifact | undefined;
  let planningSpec: PlanningSpecArtifact | undefined;
  let planConsensus: PlanConsensusArtifact | undefined;

  const recommendedPreflight =
    !consultationPlan && options.preflight && planningLane !== "explicit-plan"
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
          ...(options.requirePlanningClarification ? { requirePlanningClarification: true } : {}),
        })
      : undefined;
  const preflight = consultationPlan?.preflight ?? recommendedPreflight?.preflight;

  const createdAt = new Date().toISOString();
  const configPath = runPaths.configPath;
  await writeJsonFile(configPath, config);

  if (!consultationPlan && planningLane === "explicit-plan") {
    const activeInterview = await classifyPlanningContinuation({
      activeInterview: await findActivePlanningInterview(projectRoot),
      adapter,
      projectRoot,
      reportsDir,
      runId,
      taskPacket,
    });
    planningDepth = await recommendPlanningDepthArtifact({
      adapter,
      caps: planningLoopCaps,
      createdAt,
      projectRoot,
      reportsDir,
      runId,
      taskPacket,
    });

    if (planningDepth.readiness === "blocked") {
      const blockedPreflight = {
        decision: "abstain" as const,
        confidence: toPreflightConfidence(planningDepth.confidence),
        summary: planningDepth.summary,
        researchPosture: "unknown" as const,
      };
      await writePlanningInterviewArtifacts({
        depth: planningDepth,
        projectRoot,
        runId,
      });
      return await persistBlockedPlanningManifest({
        agent,
        config,
        configPath,
        createdAt,
        preflight: blockedPreflight,
        projectRoot,
        runId,
        store,
        taskPacket,
        taskPath: resolvedTaskPath,
        writeConsultationPlanArtifacts: Boolean(options.writeConsultationPlanArtifacts),
      });
    }
    if (planningDepth.readiness === "needs-interview" && planningDepth.maxInterviewRounds === 0) {
      const blockedPreflight = {
        decision: "needs-clarification" as const,
        confidence: toPreflightConfidence(planningDepth.confidence),
        summary: "Planning depth requires clarification, but explicitPlanMaxInterviewRounds is 0.",
        researchPosture: "repo-only" as const,
        clarificationQuestion:
          "Add the missing result contract, scope boundaries, and judging criteria to the task text, or raise explicitPlanMaxInterviewRounds in .oraculum/advanced.json.",
      };
      await writePlanningInterviewArtifacts({
        depth: planningDepth,
        projectRoot,
        runId,
      });
      return await persistBlockedPlanningManifest({
        agent,
        config,
        configPath,
        createdAt,
        preflight: blockedPreflight,
        projectRoot,
        runId,
        store,
        taskPacket,
        taskPath: resolvedTaskPath,
        writeConsultationPlanArtifacts: Boolean(options.writeConsultationPlanArtifacts),
      });
    }

    const shouldContinueInterviewLoop = Boolean(activeInterview);
    const shouldStartInterviewLoop =
      planningDepth.maxInterviewRounds > 0 &&
      (planningDepth.readiness === "needs-interview" ||
        planningDepth.interviewDepth !== "skip-interview" ||
        planningDepth.estimatedInterviewRounds > 0);

    if (shouldContinueInterviewLoop && activeInterview) {
      planningInterview = await scorePlanningInterviewAnswer({
        adapter,
        answer: taskPacket.intent,
        createdAt,
        depth: planningDepth,
        priorInterview: activeInterview,
        projectRoot,
        reportsDir,
        runId,
        taskPacket,
      });
      if (planningInterview.status !== "ready-for-spec") {
        planningInterview = await buildPlanningInterviewNeedingAnswer({
          adapter,
          createdAt,
          depth: planningDepth,
          priorInterview: planningInterview,
          projectRoot,
          reportsDir,
          runId,
          taskPacket,
        });
      }
    } else if (shouldStartInterviewLoop) {
      planningInterview = await buildPlanningInterviewNeedingAnswer({
        adapter,
        createdAt,
        depth: planningDepth,
        projectRoot,
        reportsDir,
        runId,
        taskPacket,
      });
    }

    if (planningInterview?.status === "needs-clarification") {
      const blockedPreflight = {
        decision: "needs-clarification" as const,
        confidence: toPreflightConfidence(planningDepth.confidence),
        summary: planningDepth.summary,
        researchPosture: "repo-only" as const,
        clarificationQuestion:
          planningInterview.nextQuestion ??
          planningInterview.rounds.at(-1)?.question ??
          "Clarify the task contract before creating the consultation plan.",
      };
      await writePlanningInterviewArtifacts({
        depth: planningDepth,
        interview: planningInterview,
        projectRoot,
        runId,
      });
      return await persistBlockedPlanningManifest({
        agent,
        config,
        configPath,
        createdAt,
        planningInterview,
        preflight: blockedPreflight,
        projectRoot,
        runId,
        store,
        taskPacket,
        taskPath: resolvedTaskPath,
        writeConsultationPlanArtifacts: Boolean(options.writeConsultationPlanArtifacts),
      });
    }

    planningSpec = await crystallizePlanningSpecArtifact({
      adapter,
      createdAt,
      depth: planningDepth,
      ...(planningInterview ? { interview: planningInterview } : {}),
      projectRoot,
      reportsDir,
      runId,
      taskPacket,
    });
    await writePlanningInterviewArtifacts({
      depth: planningDepth,
      ...(planningInterview ? { interview: planningInterview } : {}),
      projectRoot,
      runId,
      spec: planningSpec,
    });
  }

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
      const planReview =
        options.deliberate && adapter
          ? await recommendConsultationPlanReview({
              adapter,
              consultationPlan: buildConsultationPlanArtifact({
                projectRoot,
                runId,
                createdAt,
                taskPacket,
                candidateCount: 0,
                strategies: [],
                config,
                deliberate: true,
                preflight,
                ...(recommendedPreflight?.clarifyFollowUp
                  ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
                  : {}),
              }),
              createdAt,
              projectRoot,
              reportsDir,
              runId,
            })
          : undefined;
      await writeConsultationPlanArtifacts({
        projectRoot,
        runId,
        createdAt,
        taskPacket,
        candidateCount: 0,
        strategies: [],
        config,
        ...(options.deliberate ? { deliberate: true } : {}),
        preflight,
        ...(recommendedPreflight?.clarifyFollowUp
          ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
          : {}),
        ...(planReview ? { planReview } : {}),
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

  const shouldRunConsensusLoop = Boolean(planningSpec && planningLane === "explicit-plan");
  if (shouldRunConsensusLoop && planningSpec) {
    planConsensus = await buildPlanConsensus({
      adapter,
      basePlan: buildConsultationPlanArtifact({
        projectRoot,
        runId,
        createdAt,
        taskPacket,
        candidateCount,
        strategies,
        config,
        ...(options.deliberate ? { deliberate: true } : {}),
        ...(preflight ? { preflight } : {}),
        ...(recommendedPreflight?.clarifyFollowUp
          ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
          : {}),
        ...(profileSelection
          ? { profileSelection: toCanonicalConsultationProfileSelection(profileSelection) }
          : {}),
        ...(planningInterview ? { planningInterview } : {}),
        planningSpec,
      }),
      createdAt,
      maxConsensusLoopRevisions: planningDepth?.maxConsensusRevisions ?? 0,
      planningSpec,
      projectRoot,
      reportsDir,
      runId,
      taskPacket,
    });
    await writePlanConsensusArtifact({
      consensus: planConsensus,
      projectRoot,
      runId,
    });

    if (!planConsensus.approved) {
      const blocker = summarizePlanConsensusBlocker(planConsensus);
      const blockedPreflight = {
        decision: "needs-clarification" as const,
        confidence: "medium" as const,
        summary: blocker.summary,
        researchPosture: "repo-only" as const,
        clarificationQuestion: blocker.clarificationQuestion,
      };
      return await persistBlockedPlanningManifest({
        agent,
        config,
        configPath,
        createdAt,
        ...(planningInterview ? { planningInterview } : {}),
        planningSpec,
        planConsensus,
        preflight: blockedPreflight,
        projectRoot,
        runId,
        store,
        taskPacket,
        taskPath: resolvedTaskPath,
        writeConsultationPlanArtifacts: Boolean(options.writeConsultationPlanArtifacts),
      });
    }
  }

  const candidates = await Promise.all(
    strategies.map(async (strategy, index) => {
      const candidateId = `cand-${String(index + 1).padStart(2, "0")}`;
      const candidatePaths = await store.ensureCandidateDirectories(runId, candidateId);
      const taskPacketPath = candidatePaths.taskPacketPath;
      const workspaceDir = candidatePaths.workspaceDir;

      await store.writeCandidateTaskPacket(runId, candidateId, taskPacket);

      const candidate = createPlannedCandidate({
        candidateId,
        createdAt,
        strategy,
        taskPacketPath,
        workspaceDir,
      });

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
    const planReview =
      options.deliberate && adapter
        ? await recommendConsultationPlanReview({
            adapter,
            consultationPlan: buildConsultationPlanArtifact({
              projectRoot,
              runId,
              createdAt,
              taskPacket,
              candidateCount,
              strategies,
              config,
              deliberate: true,
              ...(preflight ? { preflight } : {}),
              ...(recommendedPreflight?.clarifyFollowUp
                ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
                : {}),
              ...(profileSelection
                ? { profileSelection: toCanonicalConsultationProfileSelection(profileSelection) }
                : {}),
              ...(planningInterview ? { planningInterview } : {}),
              ...(planningSpec ? { planningSpec } : {}),
              ...(planConsensus ? { planConsensus } : {}),
            }),
            createdAt,
            projectRoot,
            reportsDir,
            runId,
          })
        : undefined;
    await writeConsultationPlanArtifacts({
      projectRoot,
      runId,
      createdAt,
      taskPacket,
      candidateCount,
      strategies,
      config,
      ...(options.deliberate ? { deliberate: true } : {}),
      ...(preflight ? { preflight } : {}),
      ...(recommendedPreflight?.clarifyFollowUp
        ? { clarifyFollowUp: recommendedPreflight.clarifyFollowUp }
        : {}),
      ...(planReview ? { planReview } : {}),
      ...(profileSelection
        ? { profileSelection: toCanonicalConsultationProfileSelection(profileSelection) }
        : {}),
      ...(planningInterview ? { planningInterview } : {}),
      ...(planningSpec ? { planningSpec } : {}),
      ...(planConsensus ? { planConsensus } : {}),
    });
  }

  return manifest;
}

async function persistBlockedPlanningManifest(options: {
  agent: RunManifest["agent"];
  config: Awaited<ReturnType<typeof loadConsultationPlanBaseConfig>>;
  configPath: string;
  createdAt: string;
  planConsensus?: PlanConsensusArtifact;
  planningInterview?: PlanningInterviewArtifact;
  planningSpec?: PlanningSpecArtifact;
  preflight: NonNullable<RunManifest["preflight"]>;
  projectRoot: string;
  runId: string;
  store: RunStore;
  taskPacket: Awaited<ReturnType<typeof loadTaskPacket>>;
  taskPath: string;
  writeConsultationPlanArtifacts: boolean;
}): Promise<RunManifest> {
  const manifest: RunManifest = {
    id: options.runId,
    status: "completed",
    taskPath: options.taskPath,
    taskPacket: buildManifestTaskPacket(options.taskPacket),
    agent: options.agent,
    configPath: options.configPath,
    candidateCount: 0,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    rounds: [],
    candidates: [],
    preflight: options.preflight,
    outcome: buildBlockedPreflightOutcome(options.preflight),
  };

  runManifestSchema.parse(manifest);
  await options.store.writeRunManifest(manifest);
  if (options.writeConsultationPlanArtifacts) {
    await writeConsultationPlanArtifacts({
      projectRoot: options.projectRoot,
      runId: options.runId,
      createdAt: options.createdAt,
      taskPacket: options.taskPacket,
      candidateCount: 0,
      strategies: [],
      config: options.config,
      preflight: options.preflight,
      ...(options.planningInterview ? { planningInterview: options.planningInterview } : {}),
      ...(options.planningSpec ? { planningSpec: options.planningSpec } : {}),
      ...(options.planConsensus ? { planConsensus: options.planConsensus } : {}),
    });
  }

  return manifest;
}

function toPreflightConfidence(value: string): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}
