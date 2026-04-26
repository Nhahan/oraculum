import { OraculumError } from "../../core/errors.js";
import {
  type ConsultActionRequest,
  type ConsultActionResponse,
  consultActionRequestSchema,
  consultActionResponseSchema,
  type PlanActionRequest,
  type PlanActionResponse,
  planActionRequestSchema,
  planActionResponseSchema,
  type UserInteractionAnswerActionRequest,
  type UserInteractionAnswerActionResponse,
  userInteractionAnswerActionRequestSchema,
  userInteractionAnswerActionResponseSchema,
  type VerdictActionRequest,
  type VerdictActionResponse,
  verdictActionRequestSchema,
  verdictActionResponseSchema,
} from "../../domain/chat-native.js";
import { isPreflightBlockedConsultation } from "../../domain/run.js";
import {
  type ConsultProgressReporter,
  consultationStartedEvent,
  planningStartedEvent,
  preflightBlockedEvent,
} from "../consult-progress.js";
import { buildVerdictReview } from "../consultations.js";
import { executeRun } from "../execution.js";
import {
  answerPlanRun,
  planRun,
  readLatestRunManifest,
  readRunManifest,
  writeLatestRunState,
} from "../runs.js";
import { resolveConsultExecutionTarget } from "./consult-resolution.js";
import {
  buildConsultationActionPayload,
  buildPlanRunRequest,
  ensureProjectInitializedForAction,
  resolveActionConsultationArtifacts,
} from "./shared.js";
import { buildUserInteraction, inferVerdictUserInteractionSurface } from "./user-interaction.js";

export async function runConsultAction(
  input: ConsultActionRequest,
  options?: {
    onProgress?: ConsultProgressReporter | undefined;
  },
): Promise<ConsultActionResponse> {
  const request = consultActionRequestSchema.parse(input);
  await options?.onProgress?.(consultationStartedEvent());
  const target = await resolveConsultExecutionTarget({
    cwd: request.cwd,
    ...(request.taskInput ? { taskInput: request.taskInput } : {}),
  });

  if (target.kind === "resume-run") {
    const execution = await executeRun({
      cwd: request.cwd,
      ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
      runId: target.runId,
    });

    return consultActionResponseSchema.parse({
      mode: "consult",
      ...(await buildActionPayloadWithUserInteraction({
        cwd: request.cwd,
        manifest: execution.manifest,
        surface: "consult",
      })),
    });
  }

  const initialized = request.taskInput
    ? await ensureProjectInitializedForAction(request.cwd)
    : undefined;
  await options?.onProgress?.(planningStartedEvent());
  const manifest = await planRun(
    buildPlanRunRequest({
      cwd: request.cwd,
      taskInput: target.taskInput,
    }),
  );
  if (isPreflightBlockedConsultation(manifest)) {
    await writeLatestRunState(request.cwd, manifest.id);
    await options?.onProgress?.(
      preflightBlockedEvent(manifest.preflight?.decision ?? "consultation cannot proceed"),
    );
    return consultActionResponseSchema.parse({
      mode: "consult",
      ...(await buildActionPayloadWithUserInteraction({
        cwd: request.cwd,
        manifest,
        initialized,
        surface: "consult",
      })),
    });
  }
  const execution = await executeRun({
    cwd: request.cwd,
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    runId: manifest.id,
  });

  return consultActionResponseSchema.parse({
    mode: "consult",
    ...(await buildActionPayloadWithUserInteraction({
      cwd: request.cwd,
      manifest: execution.manifest,
      initialized,
      surface: "consult",
    })),
  });
}

export async function runPlanAction(input: PlanActionRequest): Promise<PlanActionResponse> {
  const request = planActionRequestSchema.parse(input);
  return planActionResponseSchema.parse(await runPlanningAction("plan", request));
}

export async function runUserInteractionAnswerAction(
  input: UserInteractionAnswerActionRequest,
): Promise<UserInteractionAnswerActionResponse> {
  const request = userInteractionAnswerActionRequestSchema.parse(input);
  const answer = request.answer.trim();
  if (!answer) {
    throw new OraculumError("User interaction answer must not be blank.");
  }

  switch (request.kind) {
    case "augury-question":
      return userInteractionAnswerActionResponseSchema.parse(
        await runAuguryAnswerAction({ ...request, answer }),
      );
    case "plan-clarification":
      return userInteractionAnswerActionResponseSchema.parse(
        await runPreflightClarificationAnswerAction({ ...request, answer }),
      );
    case "consult-clarification":
      return userInteractionAnswerActionResponseSchema.parse(
        await runPreflightClarificationAnswerAction({ ...request, answer }),
      );
  }
}

export async function runVerdictAction(
  input: VerdictActionRequest,
): Promise<VerdictActionResponse> {
  const request = verdictActionRequestSchema.parse(input);
  const manifest = request.consultationId
    ? await readRunManifest(request.cwd, request.consultationId)
    : await readLatestRunManifest(request.cwd);
  const payload = await buildConsultationActionPayload(request.cwd, manifest);
  const artifacts = await resolveActionConsultationArtifacts(request.cwd, manifest);
  const userInteraction = buildUserInteraction({
    manifest,
    artifacts,
    surface: inferVerdictUserInteractionSurface({ manifest, artifacts }),
  });

  return verdictActionResponseSchema.parse({
    mode: "verdict",
    ...payload,
    review: await buildVerdictReview(manifest, payload.artifacts),
    ...(userInteraction ? { userInteraction } : {}),
  });
}

async function runPlanningAction(mode: "plan", request: PlanActionRequest) {
  const initialized = await ensureProjectInitializedForAction(request.cwd);
  const manifest = await planRun(
    buildPlanRunRequest(request, {
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
    }),
  );
  await writeLatestRunState(request.cwd, manifest.id);
  const artifacts = await resolveActionConsultationArtifacts(request.cwd, manifest);

  return {
    mode,
    ...(await buildActionPayloadWithUserInteraction({
      cwd: request.cwd,
      manifest,
      initialized,
      surface: "plan",
      artifacts,
    })),
  };
}

async function runAuguryAnswerAction(
  request: UserInteractionAnswerActionRequest,
): Promise<PlanActionResponse> {
  const initialized = await ensureProjectInitializedForAction(request.cwd);
  const manifest = await answerPlanRun({
    cwd: request.cwd,
    runId: request.runId,
    answer: request.answer,
    preflight: {
      allowRuntime: true,
    },
    autoProfile: {
      allowRuntime: true,
    },
  });
  await writeLatestRunState(request.cwd, manifest.id);

  return planActionResponseSchema.parse({
    mode: "plan",
    ...(await buildActionPayloadWithUserInteraction({
      cwd: request.cwd,
      manifest,
      initialized,
      surface: "plan",
    })),
  });
}

async function runPreflightClarificationAnswerAction(
  request: UserInteractionAnswerActionRequest,
): Promise<PlanActionResponse | ConsultActionResponse> {
  const initialized = await ensureProjectInitializedForAction(request.cwd);
  const sourceManifest = await readRunManifest(request.cwd, request.runId);
  const sourceArtifacts = await resolveActionConsultationArtifacts(request.cwd, sourceManifest);
  const activeSurface = inferVerdictUserInteractionSurface({
    manifest: sourceManifest,
    artifacts: sourceArtifacts,
  });
  const activeInteraction = buildUserInteraction({
    manifest: sourceManifest,
    artifacts: sourceArtifacts,
    surface: activeSurface,
  });
  if (!activeInteraction) {
    throw new OraculumError(
      `Run "${request.runId}" does not have an active ${request.kind} interaction.`,
    );
  }
  if (activeInteraction.kind !== request.kind) {
    throw new OraculumError(
      `Run "${request.runId}" has an active ${activeInteraction.kind} interaction, not ${request.kind}.`,
    );
  }
  if (activeInteraction.runId !== request.runId) {
    throw new OraculumError(
      `Run "${request.runId}" is stale for ${request.kind}; answer run "${activeInteraction.runId}" instead.`,
    );
  }

  const manifest = await planRun(
    buildPlanRunRequest(
      {
        cwd: request.cwd,
        taskInput: sourceManifest.taskPath,
        agent: sourceManifest.agent,
        clarificationAnswer: request.answer,
      },
      activeSurface === "plan"
        ? {
            planningLane: "explicit-plan",
            writeConsultationPlanArtifacts: true,
          }
        : undefined,
    ),
  );

  if (activeSurface === "plan") {
    await writeLatestRunState(request.cwd, manifest.id);
    return planActionResponseSchema.parse({
      mode: "plan",
      ...(await buildActionPayloadWithUserInteraction({
        cwd: request.cwd,
        manifest,
        initialized,
        surface: "plan",
      })),
    });
  }

  if (isPreflightBlockedConsultation(manifest)) {
    await writeLatestRunState(request.cwd, manifest.id);
    return consultActionResponseSchema.parse({
      mode: "consult",
      ...(await buildActionPayloadWithUserInteraction({
        cwd: request.cwd,
        manifest,
        initialized,
        surface: activeSurface,
      })),
    });
  }

  const execution = await executeRun({
    cwd: request.cwd,
    runId: manifest.id,
  });

  return consultActionResponseSchema.parse({
    mode: "consult",
    ...(await buildActionPayloadWithUserInteraction({
      cwd: request.cwd,
      manifest: execution.manifest,
      initialized,
      surface: activeSurface,
    })),
  });
}

async function buildActionPayloadWithUserInteraction(options: {
  cwd: string;
  manifest: Awaited<ReturnType<typeof readRunManifest>>;
  initialized?: Awaited<ReturnType<typeof ensureProjectInitializedForAction>>;
  surface: "plan" | "consult";
  artifacts?: Awaited<ReturnType<typeof resolveActionConsultationArtifacts>>;
}) {
  const artifacts =
    options.artifacts ?? (await resolveActionConsultationArtifacts(options.cwd, options.manifest));
  const userInteraction = buildUserInteraction({
    manifest: options.manifest,
    artifacts,
    surface: options.surface,
  });
  const payload = await buildConsultationActionPayload(
    options.cwd,
    options.manifest,
    options.initialized,
  );

  return {
    ...payload,
    ...(userInteraction ? { userInteraction } : {}),
  };
}
