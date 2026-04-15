import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { agentJudgeResultSchema } from "../src/adapters/types.js";
import {
  getClarifyFollowUpPath,
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { consultationProfileSelectionArtifactSchema } from "../src/domain/profile.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPlanArtifactSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../src/domain/run.js";
import {
  normalizeConsultationScopePath,
  resolveConsultationArtifacts,
  resolveConsultationArtifactsSync,
} from "../src/services/consultation-artifacts.js";
import { failureAnalysisSchema } from "../src/services/failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../src/services/finalist-judge.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import { initializeProject } from "../src/services/project.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("consultation artifact resolver", () => {
  it("resolves persisted consultation-plan artifacts", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-plan-artifacts";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getConsultationPlanPath(cwd, runId),
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId,
          createdAt: "2026-04-14T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run-plan-artifacts/reports/consultation-plan.json`.",
          intendedResult: "recommended result",
          decisionDrivers: ["Target artifact path: src/index.ts"],
          openQuestions: [],
          task: {
            id: "task",
            title: "Task",
            intent: "Fix the issue.",
            nonGoals: [],
            acceptanceCriteria: [],
            risks: [],
            oracleHints: [],
            strategyHints: [],
            contextFiles: [],
            source: {
              kind: "task-note",
              path: "/tmp/task.md",
            },
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
            },
          ],
          oracleIds: ["lint-fast"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getConsultationPlanMarkdownPath(cwd, runId),
      "# Consultation Plan\n\n- Run: run-plan-artifacts\n",
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.consultationPlanPath).toBe(getConsultationPlanPath(cwd, runId));
      expect(state.consultationPlanMarkdownPath).toBe(getConsultationPlanMarkdownPath(cwd, runId));
      expect(state.consultationPlan?.runId).toBe(runId);
      expect(state.consultationPlan?.readyForConsult).toBe(true);
    }
  });

  it("treats valid machine-readable comparison reports as available without markdown", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-comparison-json-only";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getFinalistComparisonJsonPath(cwd, runId),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended result",
          finalistCount: 1,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBe(getFinalistComparisonJsonPath(cwd, runId));
      expect(state.comparisonMarkdownPath).toBeUndefined();
      expect(state.manualReviewRequired).toBe(false);
    }
  });

  it("treats blank markdown comparison reports as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-blank-comparison-markdown";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(getFinalistComparisonMarkdownPath(cwd, runId), "  \n", "utf8");

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(false);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBeUndefined();
    }
  });

  it("treats non-empty markdown comparison reports as available without json", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-comparison-markdown-only";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${runId}\n\nCandidate notes.\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBe(getFinalistComparisonMarkdownPath(cwd, runId));
    }
  });

  it("treats headerless markdown comparison reports as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-headerless-comparison-markdown";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, runId),
      "# Finalist Comparison\n\nLegacy report without a run header.\n",
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(false);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBeUndefined();
    }
  });

  it("keeps valid json comparison reports available even when markdown is blank", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-comparison-json-plus-blank-markdown";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getFinalistComparisonJsonPath(cwd, runId),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended result",
          finalistCount: 1,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(getFinalistComparisonMarkdownPath(cwd, runId), " \n", "utf8");

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBe(getFinalistComparisonJsonPath(cwd, runId));
      expect(state.comparisonMarkdownPath).toBeUndefined();
    }
  });

  it("falls back to non-empty markdown when comparison json is malformed", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-invalid-json-plus-markdown";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(getFinalistComparisonJsonPath(cwd, runId), "{\n", "utf8");
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${runId}\n\nCandidate notes.\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBe(getFinalistComparisonMarkdownPath(cwd, runId));
    }
  });

  it("marks second-opinion disagreements as manual-review-required", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-disagree";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary finalist recommendation is low-confidence."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "low",
            summary: "cand-01 narrowly leads the primary recommendation.",
          },
          result: {
            runId,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-14T00:00:00.000Z",
            completedAt: "2026-04-14T00:00:01.000Z",
            exitCode: 0,
            summary: "Second opinion prefers cand-02.",
            recommendation: {
              decision: "select",
              candidateId: "cand-02",
              confidence: "medium",
              summary: "cand-02 is the safer recommendation.",
            },
            artifacts: [],
          },
          agreement: "disagrees-candidate",
          advisorySummary: "The second opinion selects a different finalist.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
    }
  });

  it("keeps agrees-select second opinions out of manual-review mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-agrees";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary finalist recommendation is low-confidence."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "low",
            summary: "cand-01 narrowly leads the primary recommendation.",
          },
          result: {
            runId,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-14T00:00:00.000Z",
            completedAt: "2026-04-14T00:00:01.000Z",
            exitCode: 0,
            summary: "Second opinion agrees with cand-01.",
            recommendation: {
              decision: "select",
              candidateId: "cand-01",
              confidence: "medium",
              summary: "cand-01 remains the safest recommendation.",
            },
            artifacts: [],
          },
          agreement: "agrees-select",
          advisorySummary: "The second opinion agrees with the primary recommendation.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(false);
    }
  });

  it("treats unavailable second opinions as manual-review-required", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-second-opinion-unavailable";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary finalist recommendation is low-confidence."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "low",
            summary: "cand-01 narrowly leads the primary recommendation.",
          },
          result: {
            runId,
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-14T00:00:00.000Z",
            completedAt: "2026-04-14T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "The second opinion was unavailable, so manual review is still required.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
    }
  });

  it("hides crowning records until an exported candidate exists", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-crowning-record";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getExportPlanPath(cwd, runId),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId,
          winnerId: "cand-01",
          branchName: `orc/${runId}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-14T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const hidden = await resolveBoth(cwd, runId, { hasExportedCandidate: false });
    const visible = await resolveBoth(cwd, runId, { hasExportedCandidate: true });

    for (const state of hidden) {
      expect(state.crowningRecordAvailable).toBe(false);
      expect(state.crowningRecordPath).toBeUndefined();
    }

    for (const state of visible) {
      expect(state.crowningRecordAvailable).toBe(true);
      expect(state.crowningRecordPath).toBe(getExportPlanPath(cwd, runId));
    }
  });

  it("hides invalid export plans even when an exported candidate exists", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-invalid-crowning-record";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(getExportPlanPath(cwd, runId), "{\n", "utf8");

    for (const state of await resolveBoth(cwd, runId, { hasExportedCandidate: true })) {
      expect(state.crowningRecordAvailable).toBe(false);
      expect(state.crowningRecordPath).toBeUndefined();
    }
  });

  it("ignores run-scoped artifacts whose embedded runId does not match the consultation", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-current";
    const staleRunId = "run-stale";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getPreflightReadinessPath(cwd, runId),
      `${JSON.stringify(
        consultationPreflightReadinessArtifactSchema.parse({
          runId: staleRunId,
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            decision: "proceed",
            confidence: "low",
            summary: "The stale preflight artifact should be ignored.",
            researchPosture: "repo-only",
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getClarifyFollowUpPath(cwd, runId),
      `${JSON.stringify(
        consultationClarifyFollowUpSchema.parse({
          runId: staleRunId,
          adapter: "codex",
          decision: "needs-clarification",
          scopeKeyType: "target-artifact",
          scopeKey: "docs/PRD.md",
          repeatedCaseCount: 2,
          repeatedKinds: ["clarify-needed"],
          summary: "The same clarify blocker repeated.",
          keyQuestion: "Which section should change?",
          missingResultContract: "The target result is still underspecified.",
          missingJudgingBasis: "The judging basis is not explicit yet.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getResearchBriefPath(cwd, runId),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
          runId: staleRunId,
          decision: "external-research-required",
          question: "Which section should change?",
          confidence: "medium",
          researchPosture: "external-research-required",
          summary: "The stale research brief should be ignored.",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
            artifactKind: "document",
            targetArtifactPath: "docs/PRD.md",
          },
          sources: [],
          claims: [],
          versionNotes: [],
          unresolvedConflicts: [],
          conflictHandling: "accepted",
          notes: [],
          signalSummary: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getProfileSelectionPath(cwd, runId),
      `${JSON.stringify(
        consultationProfileSelectionArtifactSchema.parse({
          runId: staleRunId,
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            validationProfileId: "library",
            confidence: "high",
            validationSummary: "The stale profile recommendation should be ignored.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            selectedCommandIds: [],
            validationGaps: [],
          },
          appliedSelection: {
            profileId: "library",
            validationProfileId: "library",
            confidence: "high",
            source: "llm-recommendation",
            summary: "The stale profile recommendation should be ignored.",
            validationSummary: "The stale profile recommendation should be ignored.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            oracleIds: ["lint-fast"],
            missingCapabilities: [],
            validationGaps: [],
            signals: ["package-export"],
            validationSignals: ["package-export"],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFailureAnalysisPath(cwd, runId),
      `${JSON.stringify(
        failureAnalysisSchema.parse({
          runId: staleRunId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          trigger: "judge-abstained",
          summary: "The stale failure analysis should be ignored.",
          recommendedAction: "investigate-root-cause-before-rerun",
          validationGaps: [],
          candidates: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        agentJudgeResultSchema.parse({
          runId: staleRunId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "The stale winner selection should be ignored.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 wins.",
          },
          artifacts: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFinalistComparisonJsonPath(cwd, runId),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId: staleRunId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended result",
          finalistCount: 1,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${staleRunId}\n\nStale markdown report.\n`,
      "utf8",
    );
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId: staleRunId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary finalist recommendation is low-confidence."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "low",
            summary: "cand-01 is the primary recommendation.",
          },
          result: {
            runId: staleRunId,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-14T00:00:00.000Z",
            completedAt: "2026-04-14T00:00:01.000Z",
            exitCode: 0,
            summary: "The stale second opinion disagrees.",
            recommendation: {
              decision: "select",
              candidateId: "cand-02",
              confidence: "medium",
              summary: "cand-02 is safer.",
            },
            artifacts: [],
          },
          agreement: "disagrees-candidate",
          advisorySummary: "The stale second opinion should be ignored.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getExportPlanPath(cwd, runId),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: staleRunId,
          winnerId: "cand-01",
          branchName: `orc/${staleRunId}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-14T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId, { hasExportedCandidate: true })) {
      expect(state.preflightReadinessPath).toBeUndefined();
      expect(state.clarifyFollowUpPath).toBeUndefined();
      expect(state.researchBriefPath).toBeUndefined();
      expect(state.failureAnalysisPath).toBeUndefined();
      expect(state.profileSelectionPath).toBeUndefined();
      expect(state.winnerSelectionPath).toBeUndefined();
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.secondOpinionWinnerSelectionPath).toBeUndefined();
      expect(state.crowningRecordPath).toBeUndefined();
      expect(state.comparisonReportAvailable).toBe(false);
      expect(state.manualReviewRequired).toBe(false);
      expect(state.crowningRecordAvailable).toBe(false);
    }
  });

  it("treats legacy research brief and profile selection artifacts that omit runId as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-legacy";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, runId),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question: "What do the official docs require?",
          confidence: "medium",
          researchPosture: "external-research-required",
          summary: "Legacy research brief remains usable.",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
            artifactKind: "document",
            targetArtifactPath: "docs/PRD.md",
          },
          sources: [],
          claims: [],
          versionNotes: [],
          unresolvedConflicts: [],
          conflictHandling: "accepted",
          notes: [],
          signalSummary: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getProfileSelectionPath(cwd, runId),
      `${JSON.stringify(
        {
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            validationProfileId: "library",
            confidence: "high",
            validationSummary: "Legacy profile selection remains usable.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            selectedCommandIds: [],
            validationGaps: [],
          },
          appliedSelection: {
            profileId: "library",
            validationProfileId: "library",
            confidence: "high",
            source: "llm-recommendation",
            summary: "Legacy profile selection remains usable.",
            validationSummary: "Legacy profile selection remains usable.",
            candidateCount: 4,
            strategyIds: ["minimal-change"],
            oracleIds: ["lint-fast"],
            missingCapabilities: [],
            validationGaps: [],
            signals: ["package-export"],
            validationSignals: ["package-export"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.researchBriefPath).toBeUndefined();
      expect(state.profileSelectionPath).toBeUndefined();
    }
  });

  it("treats legacy preflight-readiness artifacts that omit runId as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-legacy-preflight";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeFile(
      getPreflightReadinessPath(cwd, runId),
      `${JSON.stringify(
        {
          signals: {
            packageManager: "npm",
            dependencies: [],
            scripts: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            decision: "proceed",
            confidence: "low",
            summary: "Legacy preflight remains usable.",
            researchPosture: "repo-only",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.preflightReadinessPath).toBeUndefined();
      expect(state.preflightReadiness).toBeUndefined();
    }
  });

  it("keeps comparison and crowning artifacts available while second-opinion unavailability still requires manual review", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-unavailable-second-opinion-with-export";
    await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
    await writeComparisonArtifacts(cwd, runId);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "medium",
            summary: "cand-01 remains the primary recommendation.",
          },
          result: {
            runId,
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-15T00:00:00.000Z",
            completedAt: "2026-04-15T00:00:01.000Z",
            exitCode: 1,
            summary: "Second-opinion judge was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary: "Manual review is still required because the second opinion failed.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getExportPlanPath(cwd, runId),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId,
          winnerId: "cand-01",
          branchName: `orc/${runId}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-15T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId, { hasExportedCandidate: true })) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBe(getFinalistComparisonJsonPath(cwd, runId));
      expect(state.secondOpinionWinnerSelectionPath).toBe(
        getSecondOpinionWinnerSelectionPath(cwd, runId),
      );
      expect(state.manualReviewRequired).toBe(true);
      expect(state.crowningRecordAvailable).toBe(true);
      expect(state.crowningRecordPath).toBe(getExportPlanPath(cwd, runId));
    }
  });

  it("normalizes relative and in-repo absolute scope paths consistently", async () => {
    const cwd = await createInitializedProject();
    const absoluteInRepo = join(cwd, "docs", "PRD.md");
    const externalRelative = "../shared/PRD.md";
    const externalAbsolute = join(cwd, externalRelative);

    expect(normalizeConsultationScopePath(cwd, "docs/PRD.md")).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, "./docs/PRD.md")).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, absoluteInRepo)).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, externalRelative)).toBe(externalAbsolute);
    expect(normalizeConsultationScopePath(cwd, externalAbsolute)).toBe(externalAbsolute);
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "oraculum-consultation-artifacts-"));
  tempRoots.push(cwd);
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function resolveBoth(
  cwd: string,
  runId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
) {
  return [
    await resolveConsultationArtifacts(cwd, runId, options),
    resolveConsultationArtifactsSync(cwd, runId, options),
  ];
}

async function writeComparisonArtifacts(cwd: string, runId: string): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getFinalistComparisonJsonPath(cwd, runId),
    `${JSON.stringify(
      comparisonReportSchema.parse({
        runId,
        generatedAt: "2026-04-15T00:00:00.000Z",
        agent: "codex",
        task: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        targetResultLabel: "recommended result",
        finalistCount: 1,
        researchRerunRecommended: false,
        verificationLevel: "standard",
        finalists: [],
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}
