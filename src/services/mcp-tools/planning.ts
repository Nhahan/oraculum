import { resolveProjectRoot } from "../../core/paths.js";
import {
  type ConsultToolRequest,
  type ConsultToolResponse,
  consultToolRequestSchema,
  consultToolResponseSchema,
  type DraftToolRequest,
  type DraftToolResponse,
  draftToolRequestSchema,
  draftToolResponseSchema,
  type PlanToolRequest,
  type PlanToolResponse,
  planToolRequestSchema,
  planToolResponseSchema,
  type VerdictArchiveToolRequest,
  type VerdictArchiveToolResponse,
  type VerdictToolRequest,
  type VerdictToolResponse,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../../domain/chat-native.js";
import { isPreflightBlockedConsultation, type RunManifest } from "../../domain/run.js";
import {
  type ConsultProgressReporter,
  consultationStartedEvent,
  planningStartedEvent,
  preflightBlockedEvent,
} from "../consult-progress.js";
import {
  buildVerdictReview,
  isInvalidConsultationRecord,
  listRecentConsultationRecords,
  renderConsultationArchive,
} from "../consultations.js";
import { executeRun } from "../execution.js";
import { planRun, readLatestRunManifest, readRunManifest, writeLatestRunState } from "../runs.js";

import {
  buildConsultationToolPayload,
  buildPlanRunRequest,
  ensureProjectInitializedForTool,
} from "./shared.js";

export async function runConsultTool(
  input: ConsultToolRequest,
  options?: {
    onProgress?: ConsultProgressReporter | undefined;
  },
): Promise<ConsultToolResponse> {
  const request = consultToolRequestSchema.parse(input);
  await options?.onProgress?.(consultationStartedEvent());
  const initialized = await ensureProjectInitializedForTool(request.cwd);
  await options?.onProgress?.(planningStartedEvent());
  const manifest = await planRun(buildPlanRunRequest(request));
  if (isPreflightBlockedConsultation(manifest)) {
    await writeLatestRunState(request.cwd, manifest.id);
    await options?.onProgress?.(
      preflightBlockedEvent(manifest.preflight?.decision ?? "consultation cannot proceed"),
    );
    return consultToolResponseSchema.parse({
      mode: "consult",
      ...(await buildConsultationToolPayload(request.cwd, manifest, initialized)),
    });
  }
  const execution = await executeRun({
    cwd: request.cwd,
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
    runId: manifest.id,
  });

  return consultToolResponseSchema.parse({
    mode: "consult",
    ...(await buildConsultationToolPayload(request.cwd, execution.manifest, initialized)),
  });
}

export async function runPlanTool(input: PlanToolRequest): Promise<PlanToolResponse> {
  const request = planToolRequestSchema.parse(input);
  return planToolResponseSchema.parse(await runPlanningTool("plan", request));
}

export async function runDraftTool(input: DraftToolRequest): Promise<DraftToolResponse> {
  const request = draftToolRequestSchema.parse(input);
  return draftToolResponseSchema.parse(await runPlanningTool("draft", request));
}

export async function runVerdictTool(input: VerdictToolRequest): Promise<VerdictToolResponse> {
  const request = verdictToolRequestSchema.parse(input);
  const manifest = request.consultationId
    ? await readRunManifest(request.cwd, request.consultationId)
    : await readLatestRunManifest(request.cwd);
  const payload = await buildConsultationToolPayload(request.cwd, manifest);

  return verdictToolResponseSchema.parse({
    mode: "verdict",
    ...payload,
    review: await buildVerdictReview(manifest, payload.artifacts),
  });
}

export async function runVerdictArchiveTool(
  input: VerdictArchiveToolRequest,
): Promise<VerdictArchiveToolResponse> {
  const request = verdictArchiveToolRequestSchema.parse(input);
  const records = await listRecentConsultationRecords(request.cwd, request.count);
  const consultations = records.filter(
    (record): record is RunManifest => !isInvalidConsultationRecord(record),
  );

  return verdictArchiveToolResponseSchema.parse({
    mode: "verdict-archive",
    consultations,
    archive: renderConsultationArchive(records, {
      projectRoot: resolveProjectRoot(request.cwd),
      surface: "chat-native",
    }),
  });
}

async function runPlanningTool(
  mode: "plan" | "draft",
  request: PlanToolRequest | DraftToolRequest,
) {
  const initialized = await ensureProjectInitializedForTool(request.cwd);
  const manifest = await planRun(
    buildPlanRunRequest(request, {
      planningLane: "explicit-plan",
      writeConsultationPlanArtifacts: true,
    }),
  );
  await writeLatestRunState(request.cwd, manifest.id);

  return {
    mode,
    ...(await buildConsultationToolPayload(request.cwd, manifest, initialized)),
  };
}
