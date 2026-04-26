import { type Adapter, adapterSchema } from "../../domain/config.js";
import { buildSavedConsultationStatus } from "../../domain/run.js";

import { buildProjectInitializationResult } from "../chat-native.js";
import {
  type ConsultationArtifactState,
  resolveConsultationArtifacts,
  toAvailableConsultationArtifactPaths,
} from "../consultation-artifacts.js";
import { renderConsultationSummary } from "../consultations.js";
import { ensureProjectInitialized } from "../project.js";
import type { planRun, readRunManifest } from "../runs.js";

export interface InlinePlanningActionRequest {
  cwd: string;
  taskInput: string;
  agent?: Adapter | undefined;
  candidates?: number | undefined;
  clarificationAnswer?: string | undefined;
  deliberate?: boolean | undefined;
  timeoutMs?: number | undefined;
}

export async function ensureProjectInitializedForAction(cwd: string) {
  const hostDefaultAgent = resolveHostAgentRuntime();
  return ensureProjectInitialized(cwd, {
    ...(hostDefaultAgent ? { defaultAgent: hostDefaultAgent } : {}),
  });
}

export function buildPlanRunRequest(
  request: InlinePlanningActionRequest,
  options?: {
    planningLane?: "explicit-plan" | "consult-lite";
    writeConsultationPlanArtifacts?: boolean;
  },
): Parameters<typeof planRun>[0] {
  return {
    cwd: request.cwd,
    taskInput: request.taskInput,
    ...(request.agent ? { agent: request.agent } : {}),
    ...(request.candidates !== undefined ? { candidates: request.candidates } : {}),
    ...(request.clarificationAnswer ? { clarificationAnswer: request.clarificationAnswer } : {}),
    ...(request.deliberate ? { deliberate: true } : {}),
    ...(options?.planningLane ? { planningLane: options.planningLane } : {}),
    ...(options?.writeConsultationPlanArtifacts ? { writeConsultationPlanArtifacts: true } : {}),
    ...(options?.writeConsultationPlanArtifacts ? { requirePlanningClarification: true } : {}),
    preflight: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
    autoProfile: {
      allowRuntime: true,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    },
  };
}

export async function buildConsultationActionPayload(
  cwd: string,
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
  initialized?: Awaited<ReturnType<typeof ensureProjectInitialized>>,
) {
  const artifacts = await resolveActionConsultationArtifacts(cwd, consultation);

  return {
    consultation,
    status: await buildArtifactAwareConsultationStatus(consultation, artifacts),
    summary: await renderConsultationSummary(consultation, cwd, {
      resolvedArtifacts: artifacts,
      surface: "chat-native",
    }),
    artifacts: toAvailableConsultationArtifactPaths(artifacts),
    ...(artifacts.artifactDiagnostics.length > 0
      ? { artifactDiagnostics: artifacts.artifactDiagnostics }
      : {}),
    ...(initialized ? { initializedProject: buildProjectInitializationResult(initialized) } : {}),
  };
}

export async function buildArtifactAwareConsultationStatus(
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
  artifacts: ConsultationArtifactState,
) {
  return buildSavedConsultationStatus(consultation, {
    comparisonReportAvailable: artifacts.comparisonReportAvailable,
    crowningRecordAvailable: artifacts.crowningRecordAvailable,
    ...(artifacts.manualReviewRequired ? { manualReviewRequired: true } : {}),
  });
}

export async function resolveActionConsultationArtifacts(
  cwd: string,
  consultation: Awaited<ReturnType<typeof readRunManifest>>,
) {
  return resolveConsultationArtifacts(cwd, consultation.id, {
    hasExportedCandidate: consultation.candidates.some(
      (candidate) => candidate.status === "exported",
    ),
  });
}

export function normalizeOptionalStringInput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveHostAgentRuntime(): Adapter | undefined {
  const parsed = adapterSchema.safeParse(process.env.ORACULUM_AGENT_RUNTIME);
  return parsed.success ? parsed.data : undefined;
}
