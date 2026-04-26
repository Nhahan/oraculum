import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";

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
  planConsensusArtifactSchema,
  runManifestSchema,
} from "../../domain/run.js";
import { failureAnalysisSchema } from "../failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../finalist-judge.js";
import { comparisonReportSchema } from "../finalist-report.js";
import { RunStore } from "../run-store.js";

import { loadConsultationArtifacts, loadConsultationArtifactsSync } from "./loaders.js";
import { buildConsultationArtifactPathCandidates } from "./paths.js";
import { buildConsultationArtifactState } from "./state.js";
import type {
  ConsultationArtifactDiagnostic,
  ConsultationArtifactPaths,
  ConsultationArtifactState,
} from "./types.js";

export async function resolveConsultationArtifacts(
  cwd: string,
  consultationId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
): Promise<ConsultationArtifactState> {
  const paths = buildConsultationArtifactPathCandidates(cwd, consultationId);
  const state = await readConsultationArtifacts(paths, {
    ...options,
    expectedRunId: consultationId,
  });
  const lineage = await resolvePlanningSourceLineage(cwd, consultationId);
  if (!lineage) {
    return state;
  }
  if (!lineage.runId) {
    return mergePlanningSourceArtifacts(state, state, lineage);
  }

  const sourceState = await readConsultationArtifacts(
    buildConsultationArtifactPathCandidates(cwd, lineage.runId),
    {
      expectedRunId: lineage.runId,
    },
  );
  return mergePlanningSourceArtifacts(state, sourceState, lineage);
}

export function resolveConsultationArtifactsSync(
  cwd: string,
  consultationId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
): ConsultationArtifactState {
  const paths = buildConsultationArtifactPathCandidates(cwd, consultationId);
  const state = readConsultationArtifactsSync(paths, {
    ...options,
    expectedRunId: consultationId,
  });
  const lineage = resolvePlanningSourceLineageSync(cwd, consultationId);
  if (!lineage) {
    return state;
  }
  if (!lineage.runId) {
    return mergePlanningSourceArtifacts(state, state, lineage);
  }

  const sourceState = readConsultationArtifactsSync(
    buildConsultationArtifactPathCandidates(cwd, lineage.runId),
    {
      expectedRunId: lineage.runId,
    },
  );
  return mergePlanningSourceArtifacts(state, sourceState, lineage);
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

interface PlanningSourceLineage {
  runId: string;
  consultationPlanPath: string;
  diagnostics: ConsultationArtifactDiagnostic[];
}

async function resolvePlanningSourceLineage(
  cwd: string,
  consultationId: string,
): Promise<PlanningSourceLineage | undefined> {
  const store = new RunStore(cwd);
  const manifest = await store.readOptionalParsedArtifact(
    store.getRunPaths(consultationId).manifestPath,
    runManifestSchema,
  );
  if (!manifest || manifest.taskPacket.sourceKind !== "consultation-plan") {
    return undefined;
  }
  const consultationPlanPath = resolveManifestTaskPath(store.projectRoot, manifest.taskPath);

  try {
    const parsed = consultationPlanArtifactSchema.safeParse(
      JSON.parse(await readFile(consultationPlanPath, "utf8")) as unknown,
    );
    if (!parsed.success) {
      return {
        runId: "",
        consultationPlanPath,
        diagnostics: [
          {
            path: consultationPlanPath,
            kind: "planning-source-consultation-plan",
            status: "invalid",
            message: "Source consultation plan could not be parsed.",
          },
        ],
      };
    }
    return parsed.data.runId === consultationId
      ? undefined
      : {
          runId: parsed.data.runId,
          consultationPlanPath,
          diagnostics: [],
        };
  } catch (error) {
    return {
      runId: "",
      consultationPlanPath,
      diagnostics: [
        {
          path: consultationPlanPath,
          kind: "planning-source-consultation-plan",
          status: "invalid",
          message:
            error instanceof Error ? error.message : "Source consultation plan is unreadable.",
        },
      ],
    };
  }
}

function resolvePlanningSourceLineageSync(
  cwd: string,
  consultationId: string,
): PlanningSourceLineage | undefined {
  const store = new RunStore(cwd);
  const manifestPath = store.getRunPaths(consultationId).manifestPath;
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  const manifestParsed = runManifestSchema.safeParse(rawManifest);
  if (
    !manifestParsed.success ||
    manifestParsed.data.taskPacket.sourceKind !== "consultation-plan"
  ) {
    return undefined;
  }
  const consultationPlanPath = resolveManifestTaskPath(
    store.projectRoot,
    manifestParsed.data.taskPath,
  );

  try {
    const parsed = consultationPlanArtifactSchema.safeParse(
      JSON.parse(readFileSync(consultationPlanPath, "utf8")) as unknown,
    );
    if (!parsed.success) {
      return {
        runId: "",
        consultationPlanPath,
        diagnostics: [
          {
            path: consultationPlanPath,
            kind: "planning-source-consultation-plan",
            status: "invalid",
            message: "Source consultation plan could not be parsed.",
          },
        ],
      };
    }
    return parsed.data.runId === consultationId
      ? undefined
      : {
          runId: parsed.data.runId,
          consultationPlanPath,
          diagnostics: [],
        };
  } catch (error) {
    return {
      runId: "",
      consultationPlanPath,
      diagnostics: [
        {
          path: consultationPlanPath,
          kind: "planning-source-consultation-plan",
          status: "invalid",
          message:
            error instanceof Error ? error.message : "Source consultation plan is unreadable.",
        },
      ],
    };
  }
}

function resolveManifestTaskPath(projectRoot: string, taskPath: string): string {
  return isAbsolute(taskPath) ? taskPath : resolvePath(projectRoot, taskPath);
}

function mergePlanningSourceArtifacts(
  executionState: ConsultationArtifactState,
  sourceState: ConsultationArtifactState,
  lineage: PlanningSourceLineage,
): ConsultationArtifactState {
  if (!lineage.runId) {
    return {
      ...executionState,
      artifactDiagnostics: [...executionState.artifactDiagnostics, ...lineage.diagnostics],
    };
  }

  const merged: ConsultationArtifactState = {
    ...executionState,
    planningSourceRunId: lineage.runId,
    planningSourceConsultationPlanPath: lineage.consultationPlanPath,
    artifactDiagnostics: [
      ...executionState.artifactDiagnostics,
      ...sourceState.artifactDiagnostics,
      ...lineage.diagnostics,
    ],
  };

  mergeFallback(merged, sourceState, "consultationPlanPath", "consultationPlan");
  mergeFallback(merged, sourceState, "consultationPlanReadinessPath", "consultationPlanReadiness");
  mergeFallback(merged, sourceState, "planningDepthPath", "planningDepth");
  mergeFallback(merged, sourceState, "planningInterviewPath", "planningInterview");
  mergeFallback(merged, sourceState, "planningSpecPath", "planningSpec");
  mergeFallback(merged, sourceState, "planConsensusPath", "planConsensus");
  if (!merged.consultationPlanMarkdownPath && sourceState.consultationPlanMarkdownPath) {
    merged.consultationPlanMarkdownPath = sourceState.consultationPlanMarkdownPath;
  }
  if (!merged.planningSpecMarkdownPath && sourceState.planningSpecMarkdownPath) {
    merged.planningSpecMarkdownPath = sourceState.planningSpecMarkdownPath;
  }

  return merged;
}

function mergeFallback<
  TPathKey extends keyof ConsultationArtifactState,
  TArtifactKey extends keyof ConsultationArtifactState,
>(
  target: ConsultationArtifactState,
  source: ConsultationArtifactState,
  pathKey: TPathKey,
  artifactKey: TArtifactKey,
): void {
  if (!target[artifactKey] && source[artifactKey]) {
    target[artifactKey] = source[artifactKey] as never;
  }
  if (!target[pathKey] && source[pathKey]) {
    target[pathKey] = source[pathKey] as never;
  }
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

export async function readPlanConsensusArtifact(
  path: string | undefined,
): Promise<z.infer<typeof planConsensusArtifactSchema> | undefined> {
  return readOptionalArtifact(path, planConsensusArtifactSchema);
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
