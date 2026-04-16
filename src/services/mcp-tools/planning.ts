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
import { isPreflightBlockedConsultation } from "../../domain/run.js";

import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
} from "../consultations.js";
import { executeRun } from "../execution.js";
import { planRun, readLatestRunManifest, readRunManifest, writeLatestRunState } from "../runs.js";

import {
  buildConsultationToolPayload,
  buildPlanRunRequest,
  ensureProjectInitializedForTool,
  normalizePlanningToolRequest,
} from "./shared.js";

export async function runConsultTool(input: ConsultToolRequest): Promise<ConsultToolResponse> {
  const request = normalizePlanningToolRequest(consultToolRequestSchema.parse(input));
  const initialized = await ensureProjectInitializedForTool(request.cwd);
  const manifest = await planRun(buildPlanRunRequest(request));
  if (isPreflightBlockedConsultation(manifest)) {
    await writeLatestRunState(request.cwd, manifest.id);
    return consultToolResponseSchema.parse({
      mode: "consult",
      ...(await buildConsultationToolPayload(request.cwd, manifest, initialized)),
    });
  }
  const execution = await executeRun({
    cwd: request.cwd,
    runId: manifest.id,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  });

  return consultToolResponseSchema.parse({
    mode: "consult",
    ...(await buildConsultationToolPayload(request.cwd, execution.manifest, initialized)),
  });
}

export async function runPlanTool(input: PlanToolRequest): Promise<PlanToolResponse> {
  const request = normalizePlanningToolRequest(planToolRequestSchema.parse(input));
  return planToolResponseSchema.parse(await runPlanningTool("plan", request));
}

export async function runDraftTool(input: DraftToolRequest): Promise<DraftToolResponse> {
  const request = normalizePlanningToolRequest(draftToolRequestSchema.parse(input));
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
  const consultations = await listRecentConsultations(request.cwd, request.count);

  return verdictArchiveToolResponseSchema.parse({
    mode: "verdict-archive",
    consultations,
    archive: renderConsultationArchive(consultations, {
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
      writeConsultationPlanArtifacts: true,
    }),
  );

  return {
    mode,
    ...(await buildConsultationToolPayload(request.cwd, manifest, initialized)),
  };
}
