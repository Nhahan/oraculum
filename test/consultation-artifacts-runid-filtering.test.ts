import { describe, expect, it } from "vitest";

import { agentJudgeResultSchema } from "../src/adapters/types.js";
import {
  getClarifyFollowUpPath,
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
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../src/domain/run.js";
import { failureAnalysisSchema } from "../src/services/failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../src/services/finalist-judge.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import {
  createInitializedProject,
  ensureReportsDir,
  registerConsultationArtifactsTempRootCleanup,
  resolveBoth,
  writeJsonArtifact,
} from "./helpers/consultation-artifacts.js";

registerConsultationArtifactsTempRootCleanup();

describe("consultation artifact run-id filtering", () => {
  it("ignores run-scoped artifacts whose embedded runId does not match the consultation", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-current";
    const staleRunId = "run-stale";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getPreflightReadinessPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getClarifyFollowUpPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getResearchBriefPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getProfileSelectionPath(cwd, runId),
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
          validationProfileId: "library",
          confidence: "high",
          source: "llm-recommendation",
          validationSummary: "The stale profile recommendation should be ignored.",
          candidateCount: 4,
          strategyIds: ["minimal-change"],
          oracleIds: ["lint-fast"],
          validationGaps: [],
          validationSignals: ["package-export"],
        },
      }),
    );
    await writeJsonArtifact(
      getFailureAnalysisPath(cwd, runId),
      failureAnalysisSchema.parse({
        runId: staleRunId,
        generatedAt: "2026-04-14T00:00:00.000Z",
        trigger: "judge-abstained",
        summary: "The stale failure analysis should be ignored.",
        recommendedAction: "investigate-root-cause-before-rerun",
        validationGaps: [],
        candidates: [],
      }),
    );
    await writeJsonArtifact(
      getWinnerSelectionPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getFinalistComparisonJsonPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getSecondOpinionWinnerSelectionPath(cwd, runId),
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
    );
    await writeJsonArtifact(
      getExportPlanPath(cwd, runId),
      exportPlanSchema.parse({
        runId: staleRunId,
        winnerId: "cand-01",
        branchName: `orc/${staleRunId}-cand-01`,
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath: "/tmp/stale-cand-01.patch",
        withReport: true,
        createdAt: "2026-04-14T00:00:00.000Z",
      }),
    );
    await writeJsonArtifact(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${staleRunId}\n\nStale markdown report.\n`,
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

  it("treats stale research brief and profile selection artifacts that omit runId as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-legacy";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(getResearchBriefPath(cwd, runId), {
      decision: "external-research-required",
      question: "What do the official docs require?",
      confidence: "medium",
      researchPosture: "external-research-required",
      summary: "Stale research brief should not be reused.",
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
    });
    await writeJsonArtifact(getProfileSelectionPath(cwd, runId), {
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
        validationSummary: "Stale profile selection artifact should not be reused.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: [],
        validationGaps: [],
      },
      appliedSelection: {
        validationProfileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        validationSummary: "Stale profile selection artifact should not be reused.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast"],
        validationGaps: [],
        validationSignals: ["package-export"],
      },
    });

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.researchBriefPath).toBeUndefined();
      expect(state.profileSelectionPath).toBeUndefined();
    }
  });

  it("treats stale preflight-readiness artifacts that omit runId as unavailable", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-legacy-preflight";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(getPreflightReadinessPath(cwd, runId), {
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
        summary: "Stale preflight artifact should not be reused.",
        researchPosture: "repo-only",
      },
    });

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.preflightReadinessPath).toBeUndefined();
      expect(state.preflightReadiness).toBeUndefined();
    }
  });
});
