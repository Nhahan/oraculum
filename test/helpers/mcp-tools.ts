import { join } from "node:path";

import { beforeEach, vi } from "vitest";

import { runSubprocess } from "../../src/core/subprocess.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../../src/services/consultations.js";
import { executeRun } from "../../src/services/execution.js";
import { materializeExport } from "../../src/services/exports.js";
import {
  ensureProjectInitialized,
  hasNonEmptyTextArtifact,
  initializeProject,
} from "../../src/services/project.js";
import {
  planRun,
  readLatestRunManifest,
  readRunManifest,
  writeLatestRunState,
} from "../../src/services/runs.js";
import { createVerdictReviewFixture } from "./contract-fixtures.js";
import { createTempRootHarness, writeJsonArtifact, writeTextArtifact } from "./fs.js";
import {
  createBlockedPreflightOutcomeFixture,
  createRecommendedSurvivorOutcomeFixture,
  createRunCandidateFixture,
  createRunManifestFixture,
  createRunRoundFixture,
  createTaskPacketFixture,
} from "./run-manifest.js";

export {
  writeComparisonReportJson,
  writeComparisonReportMarkdown,
  writeDisagreeingSecondOpinionSelection,
  writeExportPlanArtifact,
  writeUnavailableSecondOpinionSelection,
} from "./run-artifacts.js";

export { writeJsonArtifact, writeTextArtifact };

const tempRootHarness = createTempRootHarness("oraculum-mcp-");

export const mockedPlanRun = vi.mocked(planRun);
export const mockedReadLatestRunManifest = vi.mocked(readLatestRunManifest);
export const mockedReadRunManifest = vi.mocked(readRunManifest);
export const mockedWriteLatestRunState = vi.mocked(writeLatestRunState);
export const mockedExecuteRun = vi.mocked(executeRun);
export const mockedEnsureProjectInitialized = vi.mocked(ensureProjectInitialized);
export const mockedHasNonEmptyTextArtifact = vi.mocked(hasNonEmptyTextArtifact);
export const mockedInitializeProject = vi.mocked(initializeProject);
export const mockedListRecentConsultations = vi.mocked(listRecentConsultations);
export const mockedBuildVerdictReview = vi.mocked(buildVerdictReview);
export const mockedRenderConsultationArchive = vi.mocked(renderConsultationArchive);
export const mockedRenderConsultationSummary = vi.mocked(renderConsultationSummary);
export const mockedMaterializeExport = vi.mocked(materializeExport);
export const mockedRunSubprocess = vi.mocked(runSubprocess);

export function registerMcpToolsTestHarness(): void {
  tempRootHarness.registerCleanup();

  beforeEach(() => {
    delete process.env.ORACULUM_AGENT_RUNTIME;

    mockedPlanRun.mockReset();
    mockedReadLatestRunManifest.mockReset();
    mockedReadRunManifest.mockReset();
    mockedWriteLatestRunState.mockReset();
    mockedExecuteRun.mockReset();
    mockedEnsureProjectInitialized.mockReset();
    mockedHasNonEmptyTextArtifact.mockReset();
    mockedInitializeProject.mockReset();
    mockedListRecentConsultations.mockReset();
    mockedBuildVerdictReview.mockReset();
    mockedRenderConsultationArchive.mockReset();
    mockedRenderConsultationSummary.mockReset();
    mockedMaterializeExport.mockReset();
    mockedRunSubprocess.mockReset();

    mockedEnsureProjectInitialized.mockResolvedValue(undefined);
    mockedHasNonEmptyTextArtifact.mockResolvedValue(false);
    mockedListRecentConsultations.mockResolvedValue([createCompletedManifest()]);
    mockedBuildVerdictReview.mockResolvedValue(createDefaultVerdictReview());
    mockedRenderConsultationSummary.mockResolvedValue("Consultation summary.\n");
    mockedRenderConsultationArchive.mockReturnValue("Recent consultations.\n");
    mockedPlanRun.mockResolvedValue(createPlannedManifest());
    mockedReadLatestRunManifest.mockResolvedValue(createCompletedManifest());
    mockedReadRunManifest.mockResolvedValue(createCompletedManifest());
    mockedWriteLatestRunState.mockResolvedValue(undefined);
    mockedExecuteRun.mockResolvedValue({
      candidateResults: [],
      manifest: createCompletedManifest(),
    });
    mockedInitializeProject.mockResolvedValue({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.oraculum/config.json",
      createdPaths: ["/tmp/project/.oraculum"],
    });
    mockedMaterializeExport.mockResolvedValue({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: "/tmp/export-plan.json",
    });
    mockedRunSubprocess.mockResolvedValue(createSubprocessResult({ exitCode: 1 }));
  });
}

export async function createMcpTempRoot(prefix = "oraculum-mcp-"): Promise<string> {
  return tempRootHarness.createTempRoot(prefix);
}

export async function writeExportPatch(root: string, lines: string[]): Promise<string> {
  const patchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
  await writeTextArtifact(patchPath, lines.join("\n"));
  return patchPath;
}

export function createPlannedManifest() {
  return createRunManifestFixture({
    status: "planned",
    rounds: [createRunRoundFixture("pending")],
    candidates: [
      createCandidate("cand-01", {
        status: "planned",
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
      }),
    ],
    overrides: {
      taskPacket: createTaskPacketFixture(),
      configPath: "/tmp/project/.oraculum/runs/run_1/reports/consultation-config.json",
    },
  });
}

export function createCompletedManifest() {
  return {
    ...createPlannedManifest(),
    status: "completed" as const,
    profileSelection: {
      profileId: "library" as const,
      validationProfileId: "library" as const,
      confidence: "high" as const,
      source: "llm-recommendation" as const,
      summary: "Package export evidence is strongest.",
      validationSummary: "Package export evidence is strongest.",
      candidateCount: 4,
      strategyIds: ["minimal-change", "test-amplified"],
      oracleIds: ["lint-fast", "full-suite-deep"],
      missingCapabilities: [],
      validationGaps: [],
      signals: ["package-export"],
      validationSignals: ["package-export"],
    },
    recommendedWinner: {
      candidateId: "cand-01",
      confidence: "high" as const,
      source: "llm-judge" as const,
      summary: "cand-01 is the recommended survivor.",
    },
    outcome: createRecommendedSurvivorOutcomeFixture({
      missingCapabilityCount: 0,
      judgingBasisKind: "repo-local-oracle",
    }),
    candidates: [
      createCandidate("cand-01", {
        status: "promoted",
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
      }),
    ],
  };
}

export function createFinalistsWithoutRecommendationManifest() {
  return {
    ...createCompletedManifest(),
    candidateCount: 2,
    candidates: [
      createCandidate("cand-01", {
        status: "promoted",
        workspaceDir: "/tmp/cand-01",
        taskPacketPath: "/tmp/cand-01.json",
      }),
      createCandidate("cand-02", {
        status: "promoted",
        workspaceDir: "/tmp/cand-02",
        taskPacketPath: "/tmp/cand-02.json",
        strategyId: "safety-first",
        strategyLabel: "Safety First",
      }),
    ],
    outcome: {
      type: "finalists-without-recommendation" as const,
      terminal: true,
      crownable: false,
      finalistCount: 2,
      validationPosture: "sufficient" as const,
      verificationLevel: "standard" as const,
      missingCapabilityCount: 0,
      validationGapCount: 0,
      judgingBasisKind: "repo-local-oracle" as const,
    },
    recommendedWinner: undefined,
  };
}

export function createBlockedPreflightManifest() {
  return createRunManifestFixture({
    runId: "run_blocked",
    status: "completed",
    rounds: [],
    candidates: [],
    overrides: {
      candidateCount: 0,
      taskPacket: createTaskPacketFixture(),
      configPath: "/tmp/project/.oraculum/runs/run_blocked/reports/consultation-config.json",
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target file is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which file should Oraculum update?",
      },
      outcome: createBlockedPreflightOutcomeFixture({
        missingCapabilityCount: 0,
      }),
    },
  });
}

export function createCandidate(
  id: string,
  overrides: Partial<{
    status: "planned" | "promoted" | "exported";
    workspaceDir: string;
    taskPacketPath: string;
    strategyId: string;
    strategyLabel: string;
  }> = {},
) {
  const candidateOverrides = {
    ...(overrides.strategyId ? { strategyId: overrides.strategyId } : {}),
    ...(overrides.strategyLabel ? { strategyLabel: overrides.strategyLabel } : {}),
    workspaceDir: overrides.workspaceDir ?? `/tmp/${id}`,
    taskPacketPath: overrides.taskPacketPath ?? `/tmp/${id}.json`,
    createdAt: "2026-04-05T00:00:00.000Z",
  };

  return createRunCandidateFixture(id, overrides.status ?? "promoted", {
    ...candidateOverrides,
  });
}

export function createDefaultVerdictReview() {
  return createVerdictReviewFixture();
}

export function createSubprocessResult(
  overrides: Partial<Awaited<ReturnType<typeof runSubprocess>>> = {},
): Awaited<ReturnType<typeof runSubprocess>> {
  return {
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    stdout: "",
    stdoutTruncated: false,
    timedOut: false,
    ...overrides,
  };
}
