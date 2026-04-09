import {
  type ConsultToolRequest,
  type ConsultToolResponse,
  type CrownToolRequest,
  type CrownToolResponse,
  consultToolRequestSchema,
  consultToolResponseSchema,
  crownToolRequestSchema,
  crownToolResponseSchema,
  type DraftToolRequest,
  type DraftToolResponse,
  draftToolRequestSchema,
  draftToolResponseSchema,
  type InitToolRequest,
  type InitToolResponse,
  initToolRequestSchema,
  initToolResponseSchema,
  type SetupStatusToolRequest,
  type SetupStatusToolResponse,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
  type VerdictArchiveToolRequest,
  type VerdictArchiveToolResponse,
  type VerdictToolRequest,
  type VerdictToolResponse,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../domain/chat-native.js";
import {
  buildConsultationArtifacts,
  buildProjectInitializationResult,
  buildSetupDiagnosticsResponse,
} from "./chat-native.js";
import {
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "./consultations.js";
import { executeRun } from "./execution.js";
import { materializeExport } from "./exports.js";
import { ensureProjectInitialized, initializeProject } from "./project.js";
import { planRun, readLatestRunManifest, readRunManifest } from "./runs.js";

export async function runConsultTool(input: ConsultToolRequest): Promise<ConsultToolResponse> {
  const request = consultToolRequestSchema.parse(input);
  const initialized = await ensureProjectInitialized(request.cwd);
  const manifest = await planRun({
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    autoProfile: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
  });
  const execution = await executeRun({
    cwd: request.cwd,
    runId: manifest.id,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  });

  return consultToolResponseSchema.parse({
    mode: "consult",
    consultation: execution.manifest,
    summary: await renderConsultationSummary(execution.manifest, request.cwd),
    artifacts: buildConsultationArtifacts(request.cwd, execution.manifest.id),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  });
}

export async function runDraftTool(input: DraftToolRequest): Promise<DraftToolResponse> {
  const request = draftToolRequestSchema.parse(input);
  const initialized = await ensureProjectInitialized(request.cwd);
  const manifest = await planRun({
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    autoProfile: {
      allowRuntime: false,
    },
  });

  return draftToolResponseSchema.parse({
    mode: "draft",
    consultation: manifest,
    summary: await renderConsultationSummary(manifest, request.cwd),
    artifacts: buildConsultationArtifacts(request.cwd, manifest.id),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  });
}

export async function runVerdictTool(input: VerdictToolRequest): Promise<VerdictToolResponse> {
  const request = verdictToolRequestSchema.parse(input);
  const manifest = request.consultationId
    ? await readRunManifest(request.cwd, request.consultationId)
    : await readLatestRunManifest(request.cwd);

  return verdictToolResponseSchema.parse({
    mode: "verdict",
    consultation: manifest,
    summary: await renderConsultationSummary(manifest, request.cwd),
    artifacts: buildConsultationArtifacts(request.cwd, manifest.id),
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
    archive: renderConsultationArchive(consultations),
  });
}

export async function runCrownTool(input: CrownToolRequest): Promise<CrownToolResponse> {
  const request = crownToolRequestSchema.parse(input);
  const result = await materializeExport({
    cwd: request.cwd,
    branchName: request.branchName,
    withReport: request.withReport,
    ...(request.consultationId ? { runId: request.consultationId } : {}),
    ...(request.candidateId ? { winnerId: request.candidateId } : {}),
  });
  const consultation = await readRunManifest(request.cwd, result.plan.runId);

  return crownToolResponseSchema.parse({
    mode: "crown",
    plan: result.plan,
    recordPath: result.path,
    consultation,
  });
}

export async function runInitTool(input: InitToolRequest): Promise<InitToolResponse> {
  const request = initToolRequestSchema.parse(input);
  const initialization = await initializeProject({
    cwd: request.cwd,
    force: request.force,
  });

  return initToolResponseSchema.parse({
    mode: "init",
    initialization: buildProjectInitializationResult(initialization),
  });
}

export async function runSetupStatusTool(
  input: SetupStatusToolRequest,
): Promise<SetupStatusToolResponse> {
  const request = setupStatusToolRequestSchema.parse(input);

  return setupStatusToolResponseSchema.parse(await buildSetupDiagnosticsResponse(request.cwd));
}
