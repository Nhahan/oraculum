import { describe, expect, it } from "vitest";
import {
  getConsultationPlanMarkdownPath,
  getConsultationPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
} from "../src/core/paths.js";
import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import {
  createInitializedProject,
  ensureReportsDir,
  registerConsultationArtifactsTempRootCleanup,
  resolveBoth,
  writeJsonArtifact,
  writeTextArtifact,
} from "./helpers/consultation-artifacts.js";
import { createConsultationPlanArtifactFixture } from "./helpers/contract-fixtures.js";

registerConsultationArtifactsTempRootCleanup();

describe("consultation artifact plan and comparison resolution", () => {
  it("resolves persisted consultation-plan artifacts", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-plan-artifacts";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getConsultationPlanPath(cwd, runId),
      consultationPlanArtifactSchema.parse(
        createConsultationPlanArtifactFixture(cwd, runId, getConsultationPlanPath(cwd, runId), {
          createdAt: "2026-04-14T00:00:00.000Z",
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
          plannedStrategies: [{ id: "minimal-change", label: "Minimal Change" }],
          oracleIds: ["lint-fast"],
          roundOrder: [{ id: "fast", label: "Fast" }],
        }),
      ),
    );
    await writeTextArtifact(
      getConsultationPlanMarkdownPath(cwd, runId),
      "# Consultation Plan\n\n- Run: run-plan-artifacts\n",
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
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getFinalistComparisonJsonPath(cwd, runId),
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
    await ensureReportsDir(cwd, runId);
    await writeTextArtifact(getFinalistComparisonMarkdownPath(cwd, runId), "  \n");

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(false);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBeUndefined();
    }
  });

  it("treats non-empty markdown comparison reports as available without json", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-comparison-markdown-only";
    await ensureReportsDir(cwd, runId);
    await writeTextArtifact(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${runId}\n\nCandidate notes.\n`,
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
    await ensureReportsDir(cwd, runId);
    await writeTextArtifact(
      getFinalistComparisonMarkdownPath(cwd, runId),
      "# Finalist Comparison\n\nLegacy report without a run header.\n",
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
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getFinalistComparisonJsonPath(cwd, runId),
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
    );
    await writeTextArtifact(getFinalistComparisonMarkdownPath(cwd, runId), " \n");

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBe(getFinalistComparisonJsonPath(cwd, runId));
      expect(state.comparisonMarkdownPath).toBeUndefined();
    }
  });

  it("falls back to non-empty markdown when comparison json is malformed", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-invalid-json-plus-markdown";
    await ensureReportsDir(cwd, runId);
    await writeTextArtifact(getFinalistComparisonJsonPath(cwd, runId), "{\n");
    await writeTextArtifact(
      getFinalistComparisonMarkdownPath(cwd, runId),
      `# Finalist Comparison\n\n- Run: ${runId}\n\nCandidate notes.\n`,
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBe(getFinalistComparisonMarkdownPath(cwd, runId));
    }
  });
});
