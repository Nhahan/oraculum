import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
  writeLatestRunState: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/project.js")>(
    "../src/services/project.js",
  );

  return {
    ...actual,
    ensureProjectInitialized: vi.fn(),
    hasNonEmptyTextArtifact: vi.fn(() => false),
    hasNonEmptyTextArtifactSync: vi.fn(() => false),
    initializeProject: vi.fn(),
  };
});

vi.mock("../src/services/consultations.js", () => ({
  buildVerdictReview: vi.fn(),
  listRecentConsultations: vi.fn(),
  renderConsultationArchive: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import {
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import { exportPlanSchema } from "../src/domain/run.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import { runVerdictArchiveTool, runVerdictTool } from "../src/services/mcp-tools.js";
import {
  createCompletedManifest,
  createMcpTempRoot,
  mockedBuildVerdictReview,
  mockedHasNonEmptyTextArtifact,
  mockedListRecentConsultations,
  mockedReadRunManifest,
  mockedRenderConsultationArchive,
  registerMcpToolsTestHarness,
} from "./helpers/mcp-tools.js";

registerMcpToolsTestHarness();

describe("chat-native MCP tools: verdict and archive", () => {
  it("reopens verdicts and archives through MCP tools", async () => {
    const verdict = await runVerdictTool({
      cwd: "/tmp/project",
      consultationId: "run_9",
    });
    const archive = await runVerdictArchiveTool({
      cwd: "/tmp/project",
      count: 5,
    });

    expect(mockedReadRunManifest).toHaveBeenCalledWith("/tmp/project", "run_9");
    expect(mockedListRecentConsultations).toHaveBeenCalledWith("/tmp/project", 5);
    expect(verdict.mode).toBe("verdict");
    expect(verdict.status).toMatchObject({
      consultationId: "run_1",
      outcomeType: "recommended-survivor",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchRerunRecommended: false,
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-result"],
    });
    expect(verdict.review).toMatchObject({
      outcomeType: "recommended-survivor",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "library",
      validationSignals: ["package-export"],
      profileId: "library",
    });
    expect(archive.mode).toBe("verdict-archive");
  });
  it("omits inspect-comparison-report from verdict status when no comparison artifact is available", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-missing-comparison-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      recommendedWinner: undefined,
    });

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "rerun-with-different-candidate-count",
    ]);
  });
  it("keeps inspect-comparison-report in verdict status when only comparison json is available", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-json-only-comparison-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      recommendedWinner: undefined,
    });

    const comparisonJsonPath = getFinalistComparisonJsonPath(root, "run_1");
    await mkdir(dirname(comparisonJsonPath), { recursive: true });
    await writeFile(
      comparisonJsonPath,
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId: "run_1",
          generatedAt: "2026-04-05T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended result",
          finalistCount: 2,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });
  it("keeps inspect-comparison-report in verdict status when json is malformed but markdown is valid", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-markdown-fallback-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      recommendedWinner: undefined,
    });

    const comparisonJsonPath = getFinalistComparisonJsonPath(root, "run_1");
    const comparisonMarkdownPath = getFinalistComparisonMarkdownPath(root, "run_1");
    await mkdir(dirname(comparisonJsonPath), { recursive: true });
    await writeFile(comparisonJsonPath, "{\n", "utf8");
    await writeFile(
      comparisonMarkdownPath,
      "# Finalist Comparison\n\n- Run: run_1\n\nCandidate notes.\n",
      "utf8",
    );
    mockedHasNonEmptyTextArtifact.mockImplementation(
      async (path) => path === comparisonMarkdownPath,
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });
  it("omits direct crown from verdict status when second-opinion manual review is required", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-second-opinion-status-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
    });

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await mkdir(dirname(secondOpinionPath), { recursive: true });
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["many-changed-paths"],
          triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 0,
            summary: "Second opinion abstained.",
            recommendation: {
              decision: "abstain",
              confidence: "medium",
              summary: "Manual review is safer before crowning.",
            },
            artifacts: [],
          },
          agreement: "disagrees-select-vs-abstain",
          advisorySummary:
            "Second-opinion judge abstained, while the primary path selected a finalist.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
  it("omits direct crown from verdict status when second-opinion is unavailable", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-second-opinion-unavailable-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
    });

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await mkdir(dirname(secondOpinionPath), { recursive: true });
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Manual review is still required because the second opinion was unavailable.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
  it("omits direct crown from verdict status when a crowning record already exists", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowning-record-status-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
    });

    const exportPlanPath = getExportPlanPath(root, "run_1");
    await mkdir(dirname(exportPlanPath), { recursive: true });
    await writeFile(
      exportPlanPath,
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: "run_1",
          winnerId: "cand-01",
          branchName: "orc/run_1-cand-01",
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual(["reopen-verdict", "browse-archive"]);
  });
  it("keeps manual review explicit when a crowning record and second-opinion blocker both exist", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowning-manual-review-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
    });

    const exportPlanPath = getExportPlanPath(root, "run_1");
    await mkdir(dirname(exportPlanPath), { recursive: true });
    await writeFile(
      exportPlanPath,
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: "run_1",
          winnerId: "cand-01",
          branchName: "orc/run_1-cand-01",
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await mkdir(dirname(secondOpinionPath), { recursive: true });
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Manual review is still required because the second opinion was unavailable.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
  it("returns aligned review, artifacts, and status when a crowned recommendation still requires manual review", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowned-manual-review-response-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
    });
    mockedBuildVerdictReview.mockResolvedValueOnce({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "sufficient",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      researchBasisStatus: "unknown",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [],
      weakestEvidence: [],
      secondOpinionAdapter: "claude-code",
      secondOpinionTriggerKinds: ["low-confidence"],
      secondOpinionTriggerReasons: ["Primary judge confidence was low."],
      secondOpinionAgreement: "unavailable",
      secondOpinionSummary: "Manual review is still required because the second opinion failed.",
      manualReviewRecommended: true,
      manualCrowningCandidateIds: [],
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        secondOpinionWinnerSelection: true,
        crowningRecord: true,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });

    const exportPlanPath = getExportPlanPath(root, "run_1");
    await mkdir(dirname(exportPlanPath), { recursive: true });
    await writeFile(
      exportPlanPath,
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: "run_1",
          winnerId: "cand-01",
          branchName: "orc/run_1-cand-01",
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Manual review is still required because the second opinion was unavailable.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.artifacts.crowningRecordPath).toBe(exportPlanPath);
    expect(verdict.artifacts.secondOpinionWinnerSelectionPath).toBe(secondOpinionPath);
    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
    expect(verdict.review.manualReviewRecommended).toBe(true);
    expect(verdict.review.artifactAvailability.crowningRecord).toBe(true);
    expect(verdict.review.secondOpinionAgreement).toBe("unavailable");
  });
  it("returns aligned review, artifacts, and status when an uncrowned recommendation requires manual review", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-uncrowned-manual-review-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
    });
    mockedBuildVerdictReview.mockResolvedValueOnce({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "sufficient",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      researchBasisStatus: "unknown",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [],
      weakestEvidence: [],
      secondOpinionAdapter: "claude-code",
      secondOpinionTriggerKinds: ["many-changed-paths"],
      secondOpinionTriggerReasons: [
        "A finalist changed 3 paths, meeting the second-opinion threshold (1).",
      ],
      secondOpinionAgreement: "disagrees-select-vs-abstain",
      secondOpinionDecision: "abstain",
      secondOpinionSummary:
        "Second-opinion judge abstained, while the primary path selected a finalist.",
      manualReviewRecommended: true,
      manualCrowningCandidateIds: [],
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        secondOpinionWinnerSelection: true,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await mkdir(dirname(secondOpinionPath), { recursive: true });
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["many-changed-paths"],
          triggerReasons: ["A finalist changed 3 paths, meeting the second-opinion threshold (1)."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 0,
            summary: "Second opinion abstained.",
            recommendation: {
              decision: "abstain",
              confidence: "medium",
              summary: "Manual review is safer before crowning.",
            },
            artifacts: [],
          },
          agreement: "disagrees-select-vs-abstain",
          advisorySummary:
            "Second-opinion judge abstained, while the primary path selected a finalist.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.artifacts.crowningRecordPath).toBeUndefined();
    expect(verdict.artifacts.secondOpinionWinnerSelectionPath).toBe(secondOpinionPath);
    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
    expect(verdict.review.manualReviewRecommended).toBe(true);
    expect(verdict.review.artifactAvailability.comparisonReport).toBe(false);
    expect(verdict.review.artifactAvailability.crowningRecord).toBe(false);
    expect(verdict.review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
  });
  it("does not reintroduce comparison inspection when a crowned recommendation still requires manual review", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-crowned-manual-review-comparison-");
    const manifest = createCompletedManifest();
    mockedReadRunManifest.mockResolvedValue({
      ...manifest,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
    });

    const comparisonJsonPath = getFinalistComparisonJsonPath(root, "run_1");
    await mkdir(dirname(comparisonJsonPath), { recursive: true });
    await writeFile(
      comparisonJsonPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          finalists: [
            {
              candidateId: "cand-01",
              strategyLabel: "Minimal Change",
              winner: true,
              whyItAdvanced: "cand-01 passed the selected checks.",
              changedPaths: ["src/index.ts"],
              changedPathCount: 1,
            },
          ],
          whyThisWon: "cand-01 remains the strongest recommendation.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const exportPlanPath = getExportPlanPath(root, "run_1");
    await writeFile(
      exportPlanPath,
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: "run_1",
          winnerId: "cand-01",
          branchName: "orc/run_1-cand-01",
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const secondOpinionPath = getSecondOpinionWinnerSelectionPath(root, "run_1");
    await writeFile(
      secondOpinionPath,
      `${JSON.stringify(
        {
          runId: "run_1",
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          result: {
            runId: "run_1",
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-05T00:00:00.000Z",
            completedAt: "2026-04-05T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Manual review is still required because the second opinion was unavailable.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const verdict = await runVerdictTool({
      cwd: root,
      consultationId: "run_9",
    });

    expect(verdict.status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });
  it("renders verdict archive display paths against the resolved project root", async () => {
    const root = await createMcpTempRoot("oraculum-mcp-archive-root-");
    const nestedCwd = join(root, "packages", "app");
    await mkdir(join(root, ".oraculum"), { recursive: true });
    await writeFile(join(root, ".oraculum", "config.json"), "{}\n", "utf8");
    await mkdir(nestedCwd, { recursive: true });

    await runVerdictArchiveTool({
      cwd: nestedCwd,
      count: 3,
    });

    expect(mockedListRecentConsultations).toHaveBeenCalledWith(nestedCwd, 3);
    expect(mockedRenderConsultationArchive).toHaveBeenCalledWith([createCompletedManifest()], {
      projectRoot: root,
      surface: "chat-native",
    });
  });
});
