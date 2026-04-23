import {
  type ConsultActionRequest,
  type ConsultActionResponse,
  consultActionRequestSchema,
  consultActionResponseSchema,
  type PlanActionRequest,
  type PlanActionResponse,
  planActionRequestSchema,
  planActionResponseSchema,
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
import { planRun, readLatestRunManifest, readRunManifest, writeLatestRunState } from "../runs.js";
import { resolveConsultExecutionTarget } from "./consult-resolution.js";
import {
  buildConsultationActionPayload,
  buildPlanRunRequest,
  ensureProjectInitializedForAction,
} from "./shared.js";

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
      ...(await buildConsultationActionPayload(request.cwd, execution.manifest)),
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
      ...(await buildConsultationActionPayload(request.cwd, manifest, initialized)),
    });
  }
  const execution = await executeRun({
    cwd: request.cwd,
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    runId: manifest.id,
  });

  return consultActionResponseSchema.parse({
    mode: "consult",
    ...(await buildConsultationActionPayload(request.cwd, execution.manifest, initialized)),
  });
}

export async function runPlanAction(input: PlanActionRequest): Promise<PlanActionResponse> {
  const request = planActionRequestSchema.parse(input);
  return planActionResponseSchema.parse(await runPlanningAction("plan", request));
}

export async function runVerdictAction(
  input: VerdictActionRequest,
): Promise<VerdictActionResponse> {
  const request = verdictActionRequestSchema.parse(input);
  const manifest = request.consultationId
    ? await readRunManifest(request.cwd, request.consultationId)
    : await readLatestRunManifest(request.cwd);
  const payload = await buildConsultationActionPayload(request.cwd, manifest);

  return verdictActionResponseSchema.parse({
    mode: "verdict",
    ...payload,
    review: await buildVerdictReview(manifest, payload.artifacts),
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

  return {
    mode,
    ...(await buildConsultationActionPayload(request.cwd, manifest, initialized)),
  };
}
