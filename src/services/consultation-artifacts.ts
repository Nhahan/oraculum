import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve as resolvePath } from "node:path";

import type { ZodTypeAny, z } from "zod";

import { agentJudgeResultSchema } from "../adapters/types.js";
import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunConfigPath,
  getRunDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { consultationProfileSelectionArtifactSchema } from "../domain/profile.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../domain/run.js";

import { failureAnalysisSchema } from "./failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "./finalist-judge.js";
import { comparisonReportSchema } from "./finalist-report.js";
import { hasNonEmptyTextArtifact, hasNonEmptyTextArtifactSync } from "./project.js";

export interface ConsultationArtifactPaths {
  consultationRoot: string;
  configPath?: string;
  preflightReadinessPath?: string;
  clarifyFollowUpPath?: string;
  researchBriefPath?: string;
  failureAnalysisPath?: string;
  profileSelectionPath?: string;
  comparisonJsonPath?: string;
  comparisonMarkdownPath?: string;
  winnerSelectionPath?: string;
  secondOpinionWinnerSelectionPath?: string;
  crowningRecordPath?: string;
}

export interface ConsultationArtifactState extends ConsultationArtifactPaths {
  preflightReadiness?: z.infer<typeof consultationPreflightReadinessArtifactSchema>;
  clarifyFollowUp?: z.infer<typeof consultationClarifyFollowUpSchema>;
  researchBrief?: z.infer<typeof consultationResearchBriefSchema>;
  failureAnalysis?: z.infer<typeof failureAnalysisSchema>;
  profileSelection?: z.infer<typeof consultationProfileSelectionArtifactSchema>;
  comparisonReport?: z.infer<typeof comparisonReportSchema>;
  winnerSelection?: z.infer<typeof agentJudgeResultSchema>;
  secondOpinionWinnerSelection?: z.infer<typeof secondOpinionWinnerSelectionArtifactSchema>;
  crowningRecord?: z.infer<typeof exportPlanSchema>;
  comparisonReportAvailable: boolean;
  manualReviewRequired: boolean;
  crowningRecordAvailable: boolean;
  hasExportedCandidate: boolean;
}

export function normalizeConsultationScopePath(projectRoot: string, path: string): string {
  if (!isAbsolute(path)) {
    const normalizedPath = normalize(path);
    const resolvedPath = normalize(resolvePath(projectRoot, path));
    const relativePath = relative(projectRoot, resolvedPath);
    if (
      relativePath.length === 0 ||
      relativePath === "." ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      return resolvedPath;
    }
    return normalizedPath;
  }

  const normalizedPath = normalize(path);
  const relativePath = relative(projectRoot, normalizedPath);
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return normalizedPath;
  }

  return normalize(relativePath);
}

export function buildConsultationArtifactPathCandidates(
  cwd: string,
  consultationId: string,
): ConsultationArtifactPaths {
  const projectRoot = resolveProjectRoot(cwd);
  return {
    consultationRoot: getRunDir(projectRoot, consultationId),
    configPath: getRunConfigPath(projectRoot, consultationId),
    preflightReadinessPath: getPreflightReadinessPath(projectRoot, consultationId),
    clarifyFollowUpPath: getClarifyFollowUpPath(projectRoot, consultationId),
    researchBriefPath: getResearchBriefPath(projectRoot, consultationId),
    failureAnalysisPath: getFailureAnalysisPath(projectRoot, consultationId),
    profileSelectionPath: getProfileSelectionPath(projectRoot, consultationId),
    comparisonJsonPath: getFinalistComparisonJsonPath(projectRoot, consultationId),
    comparisonMarkdownPath: getFinalistComparisonMarkdownPath(projectRoot, consultationId),
    winnerSelectionPath: getWinnerSelectionPath(projectRoot, consultationId),
    secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(
      projectRoot,
      consultationId,
    ),
    crowningRecordPath: getExportPlanPath(projectRoot, consultationId),
  };
}

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
  const [
    parsedPreflightReadiness,
    parsedClarifyFollowUp,
    parsedResearchBrief,
    parsedFailureAnalysis,
    parsedProfileSelection,
    parsedComparisonReport,
    comparisonMarkdownAvailable,
    parsedWinnerSelection,
    parsedSecondOpinionWinnerSelection,
    parsedCrowningRecord,
  ] = await Promise.all([
    readJsonArtifact(paths.preflightReadinessPath, consultationPreflightReadinessArtifactSchema),
    readJsonArtifact(paths.clarifyFollowUpPath, consultationClarifyFollowUpSchema),
    readJsonArtifact(paths.researchBriefPath, consultationResearchBriefSchema),
    readJsonArtifact(paths.failureAnalysisPath, failureAnalysisSchema),
    readJsonArtifact(paths.profileSelectionPath, consultationProfileSelectionArtifactSchema),
    readJsonArtifact(paths.comparisonJsonPath, comparisonReportSchema),
    paths.comparisonMarkdownPath
      ? hasCurrentComparisonMarkdownArtifact(paths.comparisonMarkdownPath, options?.expectedRunId)
      : Promise.resolve(false),
    readJsonArtifact(paths.winnerSelectionPath, agentJudgeResultSchema),
    readJsonArtifact(
      paths.secondOpinionWinnerSelectionPath,
      secondOpinionWinnerSelectionArtifactSchema,
    ),
    readJsonArtifact(paths.crowningRecordPath, exportPlanSchema),
  ]);

  const expectedRunId = options?.expectedRunId;
  const preflightReadiness = filterArtifactForConsultationRun(parsedPreflightReadiness, {
    expectedRunId,
  });
  const clarifyFollowUp = filterArtifactForConsultationRun(parsedClarifyFollowUp, {
    expectedRunId,
  });
  const researchBrief = filterArtifactForConsultationRun(parsedResearchBrief, {
    expectedRunId,
  });
  const failureAnalysis = filterArtifactForConsultationRun(parsedFailureAnalysis, {
    expectedRunId,
  });
  const profileSelection = filterArtifactForConsultationRun(parsedProfileSelection, {
    expectedRunId,
  });
  const comparisonReport = filterArtifactForConsultationRun(parsedComparisonReport, {
    expectedRunId,
  });
  const winnerSelection = filterArtifactForConsultationRun(parsedWinnerSelection, {
    expectedRunId,
  });
  const secondOpinionWinnerSelection = filterArtifactForConsultationRun(
    parsedSecondOpinionWinnerSelection,
    { expectedRunId },
  );
  const hasExportedCandidate = options?.hasExportedCandidate ?? false;
  const crowningRecord = hasExportedCandidate
    ? filterArtifactForConsultationRun(parsedCrowningRecord, { expectedRunId })
    : undefined;
  const manualReviewRequired = Boolean(
    secondOpinionWinnerSelection && secondOpinionWinnerSelection.agreement !== "agrees-select",
  );

  return {
    consultationRoot: paths.consultationRoot,
    ...(paths.configPath && existsSync(paths.configPath) ? { configPath: paths.configPath } : {}),
    ...(preflightReadiness && paths.preflightReadinessPath
      ? { preflightReadinessPath: paths.preflightReadinessPath, preflightReadiness }
      : {}),
    ...(clarifyFollowUp && paths.clarifyFollowUpPath
      ? { clarifyFollowUpPath: paths.clarifyFollowUpPath, clarifyFollowUp }
      : {}),
    ...(researchBrief && paths.researchBriefPath
      ? { researchBriefPath: paths.researchBriefPath, researchBrief }
      : {}),
    ...(failureAnalysis && paths.failureAnalysisPath
      ? { failureAnalysisPath: paths.failureAnalysisPath, failureAnalysis }
      : {}),
    ...(profileSelection && paths.profileSelectionPath
      ? { profileSelectionPath: paths.profileSelectionPath, profileSelection }
      : {}),
    ...(comparisonReport && paths.comparisonJsonPath
      ? { comparisonJsonPath: paths.comparisonJsonPath, comparisonReport }
      : {}),
    ...(comparisonMarkdownAvailable && paths.comparisonMarkdownPath
      ? { comparisonMarkdownPath: paths.comparisonMarkdownPath }
      : {}),
    ...(winnerSelection && paths.winnerSelectionPath
      ? { winnerSelectionPath: paths.winnerSelectionPath, winnerSelection }
      : {}),
    ...(secondOpinionWinnerSelection && paths.secondOpinionWinnerSelectionPath
      ? {
          secondOpinionWinnerSelectionPath: paths.secondOpinionWinnerSelectionPath,
          secondOpinionWinnerSelection,
        }
      : {}),
    ...(crowningRecord && paths.crowningRecordPath
      ? { crowningRecordPath: paths.crowningRecordPath, crowningRecord }
      : {}),
    comparisonReportAvailable: Boolean(comparisonReport || comparisonMarkdownAvailable),
    manualReviewRequired,
    crowningRecordAvailable: Boolean(crowningRecord),
    hasExportedCandidate,
  };
}

export function readConsultationArtifactsSync(
  paths: ConsultationArtifactPaths,
  options?: {
    hasExportedCandidate?: boolean;
    expectedRunId?: string;
  },
): ConsultationArtifactState {
  const parsedPreflightReadiness = readJsonArtifactSync(
    paths.preflightReadinessPath,
    consultationPreflightReadinessArtifactSchema,
  );
  const parsedClarifyFollowUp = readJsonArtifactSync(
    paths.clarifyFollowUpPath,
    consultationClarifyFollowUpSchema,
  );
  const parsedResearchBrief = readJsonArtifactSync(
    paths.researchBriefPath,
    consultationResearchBriefSchema,
  );
  const parsedFailureAnalysis = readJsonArtifactSync(
    paths.failureAnalysisPath,
    failureAnalysisSchema,
  );
  const parsedProfileSelection = readJsonArtifactSync(
    paths.profileSelectionPath,
    consultationProfileSelectionArtifactSchema,
  );
  const parsedComparisonReport = readJsonArtifactSync(
    paths.comparisonJsonPath,
    comparisonReportSchema,
  );
  const comparisonMarkdownAvailable = paths.comparisonMarkdownPath
    ? hasCurrentComparisonMarkdownArtifactSync(paths.comparisonMarkdownPath, options?.expectedRunId)
    : false;
  const parsedWinnerSelection = readJsonArtifactSync(
    paths.winnerSelectionPath,
    agentJudgeResultSchema,
  );
  const parsedSecondOpinionWinnerSelection = readJsonArtifactSync(
    paths.secondOpinionWinnerSelectionPath,
    secondOpinionWinnerSelectionArtifactSchema,
  );
  const parsedCrowningRecord = readJsonArtifactSync(paths.crowningRecordPath, exportPlanSchema);
  const expectedRunId = options?.expectedRunId;
  const preflightReadiness = filterArtifactForConsultationRun(parsedPreflightReadiness, {
    expectedRunId,
  });
  const clarifyFollowUp = filterArtifactForConsultationRun(parsedClarifyFollowUp, {
    expectedRunId,
  });
  const researchBrief = filterArtifactForConsultationRun(parsedResearchBrief, {
    expectedRunId,
  });
  const failureAnalysis = filterArtifactForConsultationRun(parsedFailureAnalysis, {
    expectedRunId,
  });
  const profileSelection = filterArtifactForConsultationRun(parsedProfileSelection, {
    expectedRunId,
  });
  const comparisonReport = filterArtifactForConsultationRun(parsedComparisonReport, {
    expectedRunId,
  });
  const winnerSelection = filterArtifactForConsultationRun(parsedWinnerSelection, {
    expectedRunId,
  });
  const secondOpinionWinnerSelection = filterArtifactForConsultationRun(
    parsedSecondOpinionWinnerSelection,
    { expectedRunId },
  );
  const hasExportedCandidate = options?.hasExportedCandidate ?? false;
  const crowningRecord = hasExportedCandidate
    ? filterArtifactForConsultationRun(parsedCrowningRecord, { expectedRunId })
    : undefined;
  const manualReviewRequired = Boolean(
    secondOpinionWinnerSelection && secondOpinionWinnerSelection.agreement !== "agrees-select",
  );

  return {
    consultationRoot: paths.consultationRoot,
    ...(paths.configPath && existsSync(paths.configPath) ? { configPath: paths.configPath } : {}),
    ...(preflightReadiness && paths.preflightReadinessPath
      ? { preflightReadinessPath: paths.preflightReadinessPath, preflightReadiness }
      : {}),
    ...(clarifyFollowUp && paths.clarifyFollowUpPath
      ? { clarifyFollowUpPath: paths.clarifyFollowUpPath, clarifyFollowUp }
      : {}),
    ...(researchBrief && paths.researchBriefPath
      ? { researchBriefPath: paths.researchBriefPath, researchBrief }
      : {}),
    ...(failureAnalysis && paths.failureAnalysisPath
      ? { failureAnalysisPath: paths.failureAnalysisPath, failureAnalysis }
      : {}),
    ...(profileSelection && paths.profileSelectionPath
      ? { profileSelectionPath: paths.profileSelectionPath, profileSelection }
      : {}),
    ...(comparisonReport && paths.comparisonJsonPath
      ? { comparisonJsonPath: paths.comparisonJsonPath, comparisonReport }
      : {}),
    ...(comparisonMarkdownAvailable && paths.comparisonMarkdownPath
      ? { comparisonMarkdownPath: paths.comparisonMarkdownPath }
      : {}),
    ...(winnerSelection && paths.winnerSelectionPath
      ? { winnerSelectionPath: paths.winnerSelectionPath, winnerSelection }
      : {}),
    ...(secondOpinionWinnerSelection && paths.secondOpinionWinnerSelectionPath
      ? {
          secondOpinionWinnerSelectionPath: paths.secondOpinionWinnerSelectionPath,
          secondOpinionWinnerSelection,
        }
      : {}),
    ...(crowningRecord && paths.crowningRecordPath
      ? { crowningRecordPath: paths.crowningRecordPath, crowningRecord }
      : {}),
    comparisonReportAvailable: Boolean(comparisonReport || comparisonMarkdownAvailable),
    manualReviewRequired,
    crowningRecordAvailable: Boolean(crowningRecord),
    hasExportedCandidate,
  };
}

export function readPreflightReadinessArtifactSync(
  path: string | undefined,
): z.infer<typeof consultationPreflightReadinessArtifactSchema> | undefined {
  return readJsonArtifactSync(path, consultationPreflightReadinessArtifactSchema);
}

export async function readPreflightReadinessArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationPreflightReadinessArtifactSchema> | undefined> {
  return readJsonArtifact(path, consultationPreflightReadinessArtifactSchema);
}

export function readClarifyFollowUpArtifactSync(
  path: string | undefined,
): z.infer<typeof consultationClarifyFollowUpSchema> | undefined {
  return readJsonArtifactSync(path, consultationClarifyFollowUpSchema);
}

export async function readClarifyFollowUpArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationClarifyFollowUpSchema> | undefined> {
  return readJsonArtifact(path, consultationClarifyFollowUpSchema);
}

export async function readResearchBriefArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationResearchBriefSchema> | undefined> {
  return readJsonArtifact(path, consultationResearchBriefSchema);
}

export async function readFailureAnalysisArtifact(
  path: string | undefined,
): Promise<z.infer<typeof failureAnalysisSchema> | undefined> {
  return readJsonArtifact(path, failureAnalysisSchema);
}

export async function readProfileSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof consultationProfileSelectionArtifactSchema> | undefined> {
  return readJsonArtifact(path, consultationProfileSelectionArtifactSchema);
}

export async function readComparisonReportArtifact(
  path: string | undefined,
): Promise<z.infer<typeof comparisonReportSchema> | undefined> {
  return readJsonArtifact(path, comparisonReportSchema);
}

export async function readWinnerSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof agentJudgeResultSchema> | undefined> {
  return readJsonArtifact(path, agentJudgeResultSchema);
}

export async function readSecondOpinionWinnerSelectionArtifact(
  path: string | undefined,
): Promise<z.infer<typeof secondOpinionWinnerSelectionArtifactSchema> | undefined> {
  return readJsonArtifact(path, secondOpinionWinnerSelectionArtifactSchema);
}

export function readSecondOpinionWinnerSelectionArtifactSync(
  path: string | undefined,
): z.infer<typeof secondOpinionWinnerSelectionArtifactSchema> | undefined {
  return readJsonArtifactSync(path, secondOpinionWinnerSelectionArtifactSchema);
}

export async function readExportPlanArtifact(
  path: string | undefined,
): Promise<z.infer<typeof exportPlanSchema> | undefined> {
  return readJsonArtifact(path, exportPlanSchema);
}

export function toAvailableConsultationArtifactPaths(
  state: ConsultationArtifactState,
): ConsultationArtifactPaths {
  return {
    consultationRoot: state.consultationRoot,
    ...(state.configPath ? { configPath: state.configPath } : {}),
    ...(state.preflightReadinessPath
      ? { preflightReadinessPath: state.preflightReadinessPath }
      : {}),
    ...(state.clarifyFollowUpPath ? { clarifyFollowUpPath: state.clarifyFollowUpPath } : {}),
    ...(state.researchBriefPath ? { researchBriefPath: state.researchBriefPath } : {}),
    ...(state.failureAnalysisPath ? { failureAnalysisPath: state.failureAnalysisPath } : {}),
    ...(state.profileSelectionPath ? { profileSelectionPath: state.profileSelectionPath } : {}),
    ...(state.comparisonJsonPath ? { comparisonJsonPath: state.comparisonJsonPath } : {}),
    ...(state.comparisonMarkdownPath
      ? { comparisonMarkdownPath: state.comparisonMarkdownPath }
      : {}),
    ...(state.winnerSelectionPath ? { winnerSelectionPath: state.winnerSelectionPath } : {}),
    ...(state.secondOpinionWinnerSelectionPath
      ? { secondOpinionWinnerSelectionPath: state.secondOpinionWinnerSelectionPath }
      : {}),
    ...(state.crowningRecordPath ? { crowningRecordPath: state.crowningRecordPath } : {}),
  };
}

async function readJsonArtifact<TSchema extends ZodTypeAny>(
  path: string | undefined,
  schema: TSchema,
): Promise<z.infer<TSchema> | undefined> {
  if (!path) {
    return undefined;
  }

  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

export function filterArtifactForConsultationRun<T>(
  artifact: T | undefined,
  options: {
    expectedRunId: string | undefined;
    allowMissingRunId?: boolean;
  },
): T | undefined {
  const expectedRunId = options.expectedRunId;
  if (!artifact || !expectedRunId) {
    return artifact;
  }

  if (!hasArtifactRunId(artifact)) {
    return options.allowMissingRunId ? artifact : undefined;
  }

  return artifact.runId === expectedRunId ? artifact : undefined;
}

function hasArtifactRunId(value: unknown): value is { runId: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.runId === "string" && candidate.runId.length > 0;
}

function readJsonArtifactSync<TSchema extends ZodTypeAny>(
  path: string | undefined,
  schema: TSchema,
): z.infer<TSchema> | undefined {
  if (!path || !existsSync(path)) {
    return undefined;
  }

  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

export async function hasCurrentComparisonMarkdownArtifact(
  path: string,
  expectedRunId: string | undefined,
): Promise<boolean> {
  if (!(await hasNonEmptyTextArtifact(path))) {
    return false;
  }

  if (!expectedRunId) {
    return true;
  }

  try {
    return extractComparisonMarkdownRunId(await readFile(path, "utf8")) === expectedRunId;
  } catch {
    return false;
  }
}

export function hasCurrentComparisonMarkdownArtifactSync(
  path: string,
  expectedRunId: string | undefined,
): boolean {
  if (!hasNonEmptyTextArtifactSync(path)) {
    return false;
  }

  if (!expectedRunId) {
    return true;
  }

  try {
    return extractComparisonMarkdownRunId(readFileSync(path, "utf8")) === expectedRunId;
  } catch {
    return false;
  }
}

function extractComparisonMarkdownRunId(content: string): string | undefined {
  const match = content.match(/^- Run:\s*(.+?)\s*$/m);
  return match?.[1]?.trim() || undefined;
}
