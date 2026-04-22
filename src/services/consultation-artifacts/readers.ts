import type { ZodTypeAny, z } from "zod";

import { agentJudgeResultSchema } from "../../adapters/types.js";
import { consultationProfileSelectionArtifactSchema } from "../../domain/profile.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPlanArtifactSchema,
  consultationPlanReadinessSchema,
  consultationPlanReviewSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../../domain/run.js";
import { failureAnalysisSchema } from "../failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";
import { comparisonReportSchema } from "../finalist-report.js";
import { RunStore } from "../run-store.js";

import { loadConsultationArtifacts, loadConsultationArtifactsSync } from "./loaders.js";
import { buildConsultationArtifactPathCandidates } from "./paths.js";
import { buildConsultationArtifactState } from "./state.js";
import type { ConsultationArtifactPaths, ConsultationArtifactState } from "./types.js";

export async function resolveConsultationArtifacts(
  cwd: string,
  consultationId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
): Promise<ConsultationArtifactState> {
  const paths = buildConsultationArtifactPathCandidates(cwd, consultationId);
  return readConsultationArtifacts(paths, {
    ...options,
    expectedRunId: consultationId,
  });
}

export function resolveConsultationArtifactsSync(
  cwd: string,
  consultationId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
): ConsultationArtifactState {
  const paths = buildConsultationArtifactPathCandidates(cwd, consultationId);
  return readConsultationArtifactsSync(paths, {
    ...options,
    expectedRunId: consultationId,
  });
}

export async function readConsultationArtifacts(
  paths: ConsultationArtifactPaths,
  options?: {
    hasExportedCandidate?: boolean;
    expectedRunId?: string;
  },
): Promise<ConsultationArtifactState> {
  return buildConsultationArtifactState(
    paths,
    await loadConsultationArtifacts(paths, options?.expectedRunId),
    options,
  );
}

export function readConsultationArtifactsSync(
  paths: ConsultationArtifactPaths,
  options?: {
    hasExportedCandidate?: boolean;
    expectedRunId?: string;
  },
): ConsultationArtifactState {
  return buildConsultationArtifactState(
    paths,
    loadConsultationArtifactsSync(paths, options?.expectedRunId),
    options,
  );
}

function readOptionalArtifactSync<TSchema extends ZodTypeAny>(
  path: string | undefined,
  schema: TSchema,
): z.infer<TSchema> | undefined {
  return new RunStore(path ?? ".").readOptionalParsedArtifactSync(path, schema);
}

async function readOptionalArtifact<TSchema extends ZodTypeAny>(
  path: string | undefined,
  schema: TSchema,
): Promise<z.infer<TSchema> | undefined> {
  return new RunStore(path ?? process.cwd()).readOptionalParsedArtifact(path, schema);
}

export function readPreflightReadinessArtifactSync(
  path: string | undefined,
): z.infer<typeof consultationPreflightReadinessArtifactSchema> | undefined {
  return readOptionalArtifactSync(path, consultationPreflightReadinessArtifactSchema);
}

export async function readPreflightReadinessArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationPreflightReadinessArtifactSchema> | undefined> {
  return readOptionalArtifact(path, consultationPreflightReadinessArtifactSchema);
}

export async function readConsultationPlanArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationPlanArtifactSchema> | undefined> {
  return readOptionalArtifact(path, consultationPlanArtifactSchema);
}

export async function readConsultationPlanReadinessArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationPlanReadinessSchema> | undefined> {
  return readOptionalArtifact(path, consultationPlanReadinessSchema);
}

export async function readConsultationPlanReviewArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationPlanReviewSchema> | undefined> {
  return readOptionalArtifact(path, consultationPlanReviewSchema);
}

export function readClarifyFollowUpArtifactSync(
  path: string | undefined,
): z.infer<typeof consultationClarifyFollowUpSchema> | undefined {
  return readOptionalArtifactSync(path, consultationClarifyFollowUpSchema);
}

export async function readClarifyFollowUpArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationClarifyFollowUpSchema> | undefined> {
  return readOptionalArtifact(path, consultationClarifyFollowUpSchema);
}

export async function readResearchBriefArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationResearchBriefSchema> | undefined> {
  return readOptionalArtifact(path, consultationResearchBriefSchema);
}

export async function readFailureAnalysisArtifact(
  path: string | undefined,
): Promise<z.infer<typeof failureAnalysisSchema> | undefined> {
  return readOptionalArtifact(path, failureAnalysisSchema);
}

export async function readProfileSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationProfileSelectionArtifactSchema> | undefined> {
  return readOptionalArtifact(path, consultationProfileSelectionArtifactSchema);
}

export async function readComparisonReportArtifact(
  path: string | undefined,
): Promise<z.infer<typeof comparisonReportSchema> | undefined> {
  return readOptionalArtifact(path, comparisonReportSchema);
}

export async function readWinnerSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof agentJudgeResultSchema> | undefined> {
  return readOptionalArtifact(path, agentJudgeResultSchema);
}

export async function readSecondOpinionWinnerSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof secondOpinionWinnerSelectionArtifactSchema> | undefined> {
  return readOptionalArtifact(path, secondOpinionWinnerSelectionArtifactSchema);
}

export function readSecondOpinionWinnerSelectionArtifactSync(
  path: string | undefined,
): z.infer<typeof secondOpinionWinnerSelectionArtifactSchema> | undefined {
  return readOptionalArtifactSync(path, secondOpinionWinnerSelectionArtifactSchema);
}

export async function readExportPlanArtifact(
  path: string | undefined,
): Promise<z.infer<typeof exportPlanSchema> | undefined> {
  return readOptionalArtifact(path, exportPlanSchema);
}
