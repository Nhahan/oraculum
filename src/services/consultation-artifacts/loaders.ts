import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

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
import { hasNonEmptyTextArtifact, hasNonEmptyTextArtifactSync, pathExists } from "../project.js";

import {
  hasCurrentComparisonMarkdownArtifact,
  hasCurrentComparisonMarkdownArtifactSync,
} from "./state.js";
import type {
  ConsultationArtifactDiagnostic,
  ConsultationArtifactPaths,
  LoadedConsultationArtifacts,
} from "./types.js";

export async function loadConsultationArtifacts(
  paths: ConsultationArtifactPaths,
  expectedRunId: string | undefined,
): Promise<LoadedConsultationArtifacts> {
  const [
    consultationPlan,
    consultationPlanMarkdownAvailable,
    consultationPlanReadiness,
    consultationPlanReview,
    preflightReadiness,
    clarifyFollowUp,
    researchBrief,
    failureAnalysis,
    profileSelection,
    comparisonReport,
    comparisonMarkdownAvailable,
    winnerSelection,
    secondOpinionWinnerSelection,
    crowningRecord,
  ] = await Promise.all([
    readOptionalParsedArtifactWithDiagnostics(
      paths.consultationPlanPath,
      "consultation-plan",
      consultationPlanArtifactSchema,
    ),
    paths.consultationPlanMarkdownPath
      ? hasNonEmptyTextArtifact(paths.consultationPlanMarkdownPath)
      : Promise.resolve(false),
    readOptionalParsedArtifactWithDiagnostics(
      paths.consultationPlanReadinessPath,
      "plan-readiness",
      consultationPlanReadinessSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.consultationPlanReviewPath,
      "plan-review",
      consultationPlanReviewSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.preflightReadinessPath,
      "preflight-readiness",
      consultationPreflightReadinessArtifactSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.clarifyFollowUpPath,
      "clarify-follow-up",
      consultationClarifyFollowUpSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.researchBriefPath,
      "research-brief",
      consultationResearchBriefSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.failureAnalysisPath,
      "failure-analysis",
      failureAnalysisSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.profileSelectionPath,
      "profile-selection",
      consultationProfileSelectionArtifactSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.comparisonJsonPath,
      "finalist-comparison",
      comparisonReportSchema,
    ),
    paths.comparisonMarkdownPath
      ? hasCurrentComparisonMarkdownArtifact(paths.comparisonMarkdownPath, expectedRunId)
      : Promise.resolve(false),
    readOptionalParsedArtifactWithDiagnostics(
      paths.winnerSelectionPath,
      "winner-selection",
      agentJudgeResultSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.secondOpinionWinnerSelectionPath,
      "winner-selection-second-opinion",
      secondOpinionWinnerSelectionArtifactSchema,
    ),
    readOptionalParsedArtifactWithDiagnostics(
      paths.crowningRecordPath,
      "crowning-record",
      exportPlanSchema,
    ),
  ]);
  const parsedArtifacts = [
    consultationPlan,
    consultationPlanReadiness,
    consultationPlanReview,
    preflightReadiness,
    clarifyFollowUp,
    researchBrief,
    failureAnalysis,
    profileSelection,
    comparisonReport,
    winnerSelection,
    secondOpinionWinnerSelection,
    crowningRecord,
  ];

  return {
    consultationPlan: consultationPlan.artifact,
    consultationPlanMarkdownAvailable,
    consultationPlanReadiness: consultationPlanReadiness.artifact,
    consultationPlanReview: consultationPlanReview.artifact,
    preflightReadiness: preflightReadiness.artifact,
    clarifyFollowUp: clarifyFollowUp.artifact,
    researchBrief: researchBrief.artifact,
    failureAnalysis: failureAnalysis.artifact,
    profileSelection: profileSelection.artifact,
    comparisonReport: comparisonReport.artifact,
    comparisonMarkdownAvailable,
    winnerSelection: winnerSelection.artifact,
    secondOpinionWinnerSelection: secondOpinionWinnerSelection.artifact,
    crowningRecord: crowningRecord.artifact,
    artifactDiagnostics: parsedArtifacts.flatMap((item) =>
      item.diagnostic ? [item.diagnostic] : [],
    ),
  };
}

export function loadConsultationArtifactsSync(
  paths: ConsultationArtifactPaths,
  expectedRunId: string | undefined,
): LoadedConsultationArtifacts {
  const consultationPlan = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.consultationPlanPath,
    "consultation-plan",
    consultationPlanArtifactSchema,
  );
  const consultationPlanReadiness = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.consultationPlanReadinessPath,
    "plan-readiness",
    consultationPlanReadinessSchema,
  );
  const consultationPlanReview = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.consultationPlanReviewPath,
    "plan-review",
    consultationPlanReviewSchema,
  );
  const preflightReadiness = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.preflightReadinessPath,
    "preflight-readiness",
    consultationPreflightReadinessArtifactSchema,
  );
  const clarifyFollowUp = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.clarifyFollowUpPath,
    "clarify-follow-up",
    consultationClarifyFollowUpSchema,
  );
  const researchBrief = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.researchBriefPath,
    "research-brief",
    consultationResearchBriefSchema,
  );
  const failureAnalysis = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.failureAnalysisPath,
    "failure-analysis",
    failureAnalysisSchema,
  );
  const profileSelection = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.profileSelectionPath,
    "profile-selection",
    consultationProfileSelectionArtifactSchema,
  );
  const comparisonReport = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.comparisonJsonPath,
    "finalist-comparison",
    comparisonReportSchema,
  );
  const winnerSelection = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.winnerSelectionPath,
    "winner-selection",
    agentJudgeResultSchema,
  );
  const secondOpinionWinnerSelection = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.secondOpinionWinnerSelectionPath,
    "winner-selection-second-opinion",
    secondOpinionWinnerSelectionArtifactSchema,
  );
  const crowningRecord = readOptionalParsedArtifactWithDiagnosticsSync(
    paths.crowningRecordPath,
    "crowning-record",
    exportPlanSchema,
  );
  const parsedArtifacts = [
    consultationPlan,
    consultationPlanReadiness,
    consultationPlanReview,
    preflightReadiness,
    clarifyFollowUp,
    researchBrief,
    failureAnalysis,
    profileSelection,
    comparisonReport,
    winnerSelection,
    secondOpinionWinnerSelection,
    crowningRecord,
  ];

  return {
    consultationPlan: consultationPlan.artifact,
    consultationPlanMarkdownAvailable: paths.consultationPlanMarkdownPath
      ? hasNonEmptyTextArtifactSync(paths.consultationPlanMarkdownPath)
      : false,
    consultationPlanReadiness: consultationPlanReadiness.artifact,
    consultationPlanReview: consultationPlanReview.artifact,
    preflightReadiness: preflightReadiness.artifact,
    clarifyFollowUp: clarifyFollowUp.artifact,
    researchBrief: researchBrief.artifact,
    failureAnalysis: failureAnalysis.artifact,
    profileSelection: profileSelection.artifact,
    comparisonReport: comparisonReport.artifact,
    comparisonMarkdownAvailable: paths.comparisonMarkdownPath
      ? hasCurrentComparisonMarkdownArtifactSync(paths.comparisonMarkdownPath, expectedRunId)
      : false,
    winnerSelection: winnerSelection.artifact,
    secondOpinionWinnerSelection: secondOpinionWinnerSelection.artifact,
    crowningRecord: crowningRecord.artifact,
    artifactDiagnostics: parsedArtifacts.flatMap((item) =>
      item.diagnostic ? [item.diagnostic] : [],
    ),
  };
}

async function readOptionalParsedArtifactWithDiagnostics<TSchema extends ZodTypeAny>(
  path: string | undefined,
  kind: string,
  schema: TSchema,
): Promise<{
  artifact?: z.infer<TSchema>;
  diagnostic?: ConsultationArtifactDiagnostic;
}> {
  if (!path || !(await pathExists(path))) {
    return {};
  }

  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { artifact: parsed.data };
    }
    return {
      diagnostic: {
        path,
        kind,
        status: "invalid",
        message: formatZodError(parsed.error),
      },
    };
  } catch (error) {
    return {
      diagnostic: {
        path,
        kind,
        status: "invalid",
        message: formatArtifactReadError(error),
      },
    };
  }
}

function readOptionalParsedArtifactWithDiagnosticsSync<TSchema extends ZodTypeAny>(
  path: string | undefined,
  kind: string,
  schema: TSchema,
): {
  artifact?: z.infer<TSchema>;
  diagnostic?: ConsultationArtifactDiagnostic;
} {
  if (!path || !existsSync(path)) {
    return {};
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { artifact: parsed.data };
    }
    return {
      diagnostic: {
        path,
        kind,
        status: "invalid",
        message: formatZodError(parsed.error),
      },
    };
  } catch (error) {
    return {
      diagnostic: {
        path,
        kind,
        status: "invalid",
        message: formatArtifactReadError(error),
      },
    };
  }
}

function formatZodError(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) {
    return "Schema validation failed.";
  }
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `Schema validation failed: ${path}${issue.message}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatArtifactReadError(error: unknown): string {
  const prefix = error instanceof SyntaxError ? "Invalid JSON" : "Unreadable artifact";
  return `${prefix}: ${formatUnknownError(error)}`;
}
