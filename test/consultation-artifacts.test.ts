import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import { exportPlanSchema } from "../src/domain/run.js";
import {
  normalizeConsultationScopePath,
  resolveConsultationArtifacts,
  resolveConsultationArtifactsSync,
} from "../src/services/consultation-artifacts.js";
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
      "# Finalist Comparison\n\nCandidate notes.\n",
      "utf8",
    );

    for (const state of await resolveBoth(cwd, runId)) {
      expect(state.comparisonReportAvailable).toBe(true);
      expect(state.comparisonJsonPath).toBeUndefined();
      expect(state.comparisonMarkdownPath).toBe(getFinalistComparisonMarkdownPath(cwd, runId));
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
      "# Finalist Comparison\n\nCandidate notes.\n",
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
