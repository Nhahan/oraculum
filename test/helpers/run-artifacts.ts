import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";

import { agentJudgeResultSchema } from "../../src/adapters/types.js";
import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getRunManifestPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../../src/core/paths.js";
import {
  consultationProfileSelectionArtifactSchema,
  type ProfileRepoSignals,
} from "../../src/domain/profile.js";
import type { RunManifest } from "../../src/domain/run.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPreflightReadinessArtifactSchema,
  exportPlanSchema,
} from "../../src/domain/run.js";
import { failureAnalysisSchema } from "../../src/services/failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../../src/services/finalist-judge.js";
import { comparisonReportSchema } from "../../src/services/finalist-report.js";
import { writeJsonArtifact, writeTextArtifact } from "./fs.js";

export function createEmptyProfileRepoSignals(): ProfileRepoSignals {
  return {
    packageManager: "npm",
    scripts: [],
    dependencies: [],
    files: [],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: [],
    capabilities: [],
    provenance: [],
    commandCatalog: [],
    skippedCommandCandidates: [],
  };
}

export async function ensureRunReportsDir(cwd: string, runId: string): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
}

export async function writeRunManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await ensureRunReportsDir(cwd, manifest.id);
  await writeJsonArtifact(getRunManifestPath(cwd, manifest.id), manifest);
}

export async function writeRawRunManifest(
  cwd: string,
  runId: string,
  manifest: unknown,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getRunManifestPath(cwd, runId), manifest);
}

export async function writeProfileSelectionArtifact(
  cwd: string,
  runId: string,
  profileSelection: NonNullable<RunManifest["profileSelection"]>,
  options?: {
    selectedCommandIds?: string[];
    signals?: ProfileRepoSignals;
  },
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getProfileSelectionPath(cwd, runId),
    consultationProfileSelectionArtifactSchema.parse({
      runId,
      signals: options?.signals ?? createEmptyProfileRepoSignals(),
      recommendation: {
        validationProfileId: profileSelection.validationProfileId,
        confidence: profileSelection.confidence,
        validationSummary: profileSelection.validationSummary,
        candidateCount: profileSelection.candidateCount,
        strategyIds: profileSelection.strategyIds,
        selectedCommandIds: options?.selectedCommandIds ?? [],
        validationGaps: profileSelection.validationGaps,
      },
      appliedSelection: profileSelection,
    }),
  );
}

export async function writePreflightReadinessArtifact(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getPreflightReadinessPath(cwd, runId),
    consultationPreflightReadinessArtifactSchema.parse({
      runId,
      signals: createEmptyProfileRepoSignals(),
      recommendation: {
        decision: "proceed",
        confidence: "low",
        summary: "Proceed conservatively with the default consultation flow.",
        researchPosture: "repo-only",
      },
      ...overrides,
    }),
  );
}

export async function writeClarifyPreflightArtifact(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { recommendation: recommendationOverride, ...restOverrides } = overrides;
  const recommendation =
    recommendationOverride && typeof recommendationOverride === "object"
      ? (recommendationOverride as Record<string, unknown>)
      : {};

  await writePreflightReadinessArtifact(cwd, runId, {
    recommendation: {
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The task contract is still unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which task constraints are in scope?",
      ...recommendation,
    },
    ...restOverrides,
  });
}

export async function writeExternalResearchPreflightArtifact(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { recommendation: recommendationOverride, ...restOverrides } = overrides;
  const recommendation =
    recommendationOverride && typeof recommendationOverride === "object"
      ? (recommendationOverride as Record<string, unknown>)
      : {};

  await writePreflightReadinessArtifact(cwd, runId, {
    recommendation: {
      decision: "external-research-required",
      confidence: "high",
      summary: "Official external guidance is still required.",
      researchPosture: "external-research-required",
      researchQuestion: "Which official guidance should this task rely on?",
      ...recommendation,
    },
    ...restOverrides,
  });
}

export async function writeExportPlanArtifact(
  cwd: string,
  runId: string,
  winnerId: string,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getExportPlanPath(cwd, runId),
    exportPlanSchema.parse({
      runId,
      winnerId,
      branchName: `orc/${runId}-${winnerId}`,
      mode: "git-branch",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      withReport: true,
      createdAt: "2026-04-04T00:00:00.000Z",
    }),
  );
}

export async function writeComparisonReportJson(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getFinalistComparisonJsonPath(cwd, runId),
    comparisonReportSchema.parse({
      runId,
      generatedAt: "2026-04-04T00:00:00.000Z",
      agent: "codex",
      task: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      targetResultLabel: "recommended result",
      finalistCount: 0,
      researchRerunRecommended: false,
      verificationLevel: "standard",
      finalists: [],
      ...overrides,
    }),
  );
}

export async function writeComparisonReportMarkdown(
  cwd: string,
  runId: string,
  contents: string,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeTextArtifact(getFinalistComparisonMarkdownPath(cwd, runId), contents);
}

export async function writeComparisonArtifacts(
  cwd: string,
  runId: string,
  options?: {
    jsonOverrides?: Record<string, unknown>;
    markdownContents?: string;
  },
): Promise<void> {
  await writeComparisonReportJson(cwd, runId, options?.jsonOverrides);
  await writeComparisonReportMarkdown(
    cwd,
    runId,
    options?.markdownContents ?? `# Finalist Comparison\n\n- Run: ${runId}\n`,
  );
}

export async function writeWinnerSelection(
  cwd: string,
  runId: string,
  value: z.input<typeof agentJudgeResultSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getWinnerSelectionPath(cwd, runId), agentJudgeResultSchema.parse(value));
}

export async function writeAbstainingWinnerSelection(
  cwd: string,
  runId: string,
  overrides: Partial<z.input<typeof agentJudgeResultSchema>> = {},
): Promise<void> {
  await writeWinnerSelection(cwd, runId, {
    runId,
    adapter: "codex",
    status: "completed",
    startedAt: "2026-04-05T00:00:00.000Z",
    completedAt: "2026-04-05T00:00:01.000Z",
    exitCode: 0,
    summary: "Judge abstained because the finalists remain too close.",
    recommendation: {
      decision: "abstain",
      confidence: "medium",
      summary: "The finalists remain too close to recommend safely.",
    },
    artifacts: [],
    ...overrides,
  });
}

export async function writeSelectedWinnerSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "codex" | "claude-code";
    candidateId?: string;
    confidence?: "low" | "medium" | "high";
    recommendationSummary?: string;
    resultSummary?: string;
    judgingCriteria?: string[];
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const candidateId = options.candidateId ?? "cand-01";
  const confidence = options.confidence ?? "medium";
  await writeWinnerSelection(cwd, runId, {
    runId,
    adapter: options.adapter ?? "codex",
    status: "completed",
    startedAt: options.startedAt ?? "2026-04-05T00:00:00.000Z",
    completedAt: options.completedAt ?? "2026-04-05T00:00:01.000Z",
    exitCode: 0,
    summary: options.resultSummary ?? `${candidateId} is the recommended survivor.`,
    recommendation: {
      decision: "select",
      candidateId,
      confidence,
      summary: options.recommendationSummary ?? `${candidateId} is the recommended survivor.`,
      ...(options.judgingCriteria?.length ? { judgingCriteria: options.judgingCriteria } : {}),
    },
    artifacts: [],
  });
}

export async function writeSecondOpinionWinnerSelection(
  cwd: string,
  runId: string,
  value: z.input<typeof secondOpinionWinnerSelectionArtifactSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getSecondOpinionWinnerSelectionPath(cwd, runId),
    secondOpinionWinnerSelectionArtifactSchema.parse(value),
  );
}

export async function writeDisagreeingSecondOpinionSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "claude-code" | "codex";
    triggerKinds?: z.input<typeof secondOpinionWinnerSelectionArtifactSchema.shape.triggerKinds>;
    triggerReasons?: string[];
    primaryCandidateId?: string;
    primaryConfidence?: "low" | "medium" | "high";
    primarySummary?: string;
    resultConfidence?: "low" | "medium" | "high";
    resultSummary?: string;
    resultRunnerSummary?: string;
    advisorySummary?: string;
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const primaryCandidateId = options.primaryCandidateId ?? "cand-01";
  const primaryConfidence = options.primaryConfidence ?? "medium";
  await writeSecondOpinionWinnerSelection(cwd, runId, {
    runId,
    advisoryOnly: true,
    adapter: options.adapter ?? "claude-code",
    triggerKinds: options.triggerKinds ?? ["low-confidence"],
    triggerReasons: options.triggerReasons ?? [
      "Primary finalist recommendation is low-confidence.",
    ],
    primaryRecommendation: {
      source: "llm-judge",
      decision: "select",
      candidateId: primaryCandidateId,
      confidence: primaryConfidence,
      summary: options.primarySummary ?? `${primaryCandidateId} is the recommended survivor.`,
    },
    result: {
      runId,
      adapter: options.adapter ?? "claude-code",
      status: "completed",
      startedAt: options.startedAt ?? "2026-04-05T00:00:02.000Z",
      completedAt: options.completedAt ?? "2026-04-05T00:00:03.000Z",
      exitCode: 0,
      summary: options.resultRunnerSummary ?? "Second-opinion judge abstained.",
      recommendation: {
        decision: "abstain",
        confidence: options.resultConfidence ?? "medium",
        summary:
          options.resultSummary ?? "The evidence is still too weak to recommend a finalist safely.",
      },
      artifacts: [],
    },
    agreement: "disagrees-select-vs-abstain",
    advisorySummary:
      options.advisorySummary ??
      "Second-opinion judge abstained, while the primary path selected a finalist.",
  });
}

export async function writeUnavailableSecondOpinionSelection(
  cwd: string,
  runId: string,
  options: {
    adapter?: "claude-code" | "codex";
    triggerKinds?: z.input<typeof secondOpinionWinnerSelectionArtifactSchema.shape.triggerKinds>;
    triggerReasons?: string[];
    primaryCandidateId?: string;
    primaryConfidence?: "low" | "medium" | "high";
    primarySummary?: string;
    resultSummary?: string;
    advisorySummary?: string;
    startedAt?: string;
    completedAt?: string;
  } = {},
): Promise<void> {
  const primaryCandidateId = options.primaryCandidateId ?? "cand-01";
  const primaryConfidence = options.primaryConfidence ?? "medium";
  await writeSecondOpinionWinnerSelection(cwd, runId, {
    runId,
    advisoryOnly: true,
    adapter: options.adapter ?? "claude-code",
    triggerKinds: options.triggerKinds ?? ["low-confidence"],
    triggerReasons: options.triggerReasons ?? [
      "Primary finalist recommendation is low-confidence.",
    ],
    primaryRecommendation: {
      source: "llm-judge",
      decision: "select",
      candidateId: primaryCandidateId,
      confidence: primaryConfidence,
      summary: options.primarySummary ?? `${primaryCandidateId} is the recommended survivor.`,
    },
    result: {
      runId,
      adapter: options.adapter ?? "claude-code",
      status: "failed",
      startedAt: options.startedAt ?? "2026-04-05T00:00:02.000Z",
      completedAt: options.completedAt ?? "2026-04-05T00:00:03.000Z",
      exitCode: 1,
      summary: options.resultSummary ?? "Second-opinion judge was unavailable.",
      artifacts: [],
    },
    agreement: "unavailable",
    advisorySummary:
      options.advisorySummary ??
      "Second-opinion judge was unavailable, so manual review is still required.",
  });
}

export async function writeFailureAnalysis(
  cwd: string,
  runId: string,
  value: z.input<typeof failureAnalysisSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getFailureAnalysisPath(cwd, runId), failureAnalysisSchema.parse(value));
}

export async function writeClarifyFollowUp(
  cwd: string,
  runId: string,
  value: z.input<typeof consultationClarifyFollowUpSchema>,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(
    getClarifyFollowUpPath(cwd, runId),
    consultationClarifyFollowUpSchema.parse(value),
  );
}
