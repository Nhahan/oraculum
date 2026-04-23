import {
  getExportPlanPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
} from "../../../src/core/paths.js";
import {
  consultationProfileSelectionArtifactSchema,
  type ProfileRepoSignals,
} from "../../../src/domain/profile.js";
import type { RunManifest } from "../../../src/domain/run.js";
import {
  consultationPreflightReadinessArtifactSchema,
  exportPlanSchema,
} from "../../../src/domain/run.js";

import { writeJsonArtifact } from "../fs.js";

import { createEmptyProfileRepoSignals, ensureRunReportsDir } from "./core.js";

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
      patchPath: `/tmp/${runId}-${winnerId}.patch`,
      withReport: true,
      createdAt: "2026-04-04T00:00:00.000Z",
    }),
  );
}
