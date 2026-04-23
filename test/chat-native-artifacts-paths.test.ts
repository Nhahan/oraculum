import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPlanConsensusPath,
  getPlanningDepthPath,
  getPlanningInterviewPath,
  getPlanningSpecMarkdownPath,
  getPlanningSpecPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunConfigPath,
  getRunDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { consultToolResponseSchema } from "../src/domain/chat-native.js";
import {
  consultationClarifyFollowUpSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../src/domain/run.js";
import { buildConsultationArtifacts } from "../src/services/chat-native.js";
import { failureAnalysisSchema } from "../src/services/failure-analysis.js";
import { initializeProject } from "../src/services/project.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
  writeCompleteConsultationArtifacts,
  writeJsonArtifact,
  writePreflightReadinessArtifact,
  writeTextArtifact,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

describe("chat-native consultation artifacts", () => {
  it("builds machine-readable consultation artifact paths for MCP responses", async () => {
    const projectRoot = await createChatNativeTempRoot();
    const consultationId = "run_20260409_demo";

    await writeCompleteConsultationArtifacts(projectRoot, consultationId);

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(projectRoot, consultationId, {
        hasExportedCandidate: true,
      }),
    );

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.planningDepthPath).toBe(getPlanningDepthPath(projectRoot, consultationId));
    expect(parsed.planningInterviewPath).toBe(
      getPlanningInterviewPath(projectRoot, consultationId),
    );
    expect(parsed.planningSpecPath).toBe(getPlanningSpecPath(projectRoot, consultationId));
    expect(parsed.planningSpecMarkdownPath).toBe(
      getPlanningSpecMarkdownPath(projectRoot, consultationId),
    );
    expect(parsed.planConsensusPath).toBe(getPlanConsensusPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
    expect(parsed.clarifyFollowUpPath).toBe(getClarifyFollowUpPath(projectRoot, consultationId));
    expect(parsed.researchBriefPath).toBe(getResearchBriefPath(projectRoot, consultationId));
    expect(parsed.failureAnalysisPath).toBe(getFailureAnalysisPath(projectRoot, consultationId));
    expect(parsed.profileSelectionPath).toBe(getProfileSelectionPath(projectRoot, consultationId));
    expect(parsed.comparisonJsonPath).toBe(
      getFinalistComparisonJsonPath(projectRoot, consultationId),
    );
    expect(parsed.comparisonMarkdownPath).toBe(
      getFinalistComparisonMarkdownPath(projectRoot, consultationId),
    );
    expect(parsed.winnerSelectionPath).toBe(getWinnerSelectionPath(projectRoot, consultationId));
    expect(parsed.secondOpinionWinnerSelectionPath).toBe(
      getSecondOpinionWinnerSelectionPath(projectRoot, consultationId),
    );
    expect(parsed.crowningRecordPath).toBe(getExportPlanPath(projectRoot, consultationId));
  });

  it("resolves consultation artifacts from a nested cwd", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-nested-");
    const nestedCwd = join(projectRoot, "packages", "app");
    const consultationId = "run_20260409_nested";

    await initializeProject({ cwd: projectRoot, force: false });
    await mkdir(nestedCwd, { recursive: true });
    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeTextArtifact(getRunConfigPath(projectRoot, consultationId), "{}\n");
    await writeJsonArtifact(
      getClarifyFollowUpPath(projectRoot, consultationId),
      consultationClarifyFollowUpSchema.parse({
        runId: consultationId,
        adapter: "codex",
        decision: "needs-clarification",
        scopeKeyType: "task-source",
        scopeKey: "tasks/operator-memo.md",
        repeatedCaseCount: 2,
        repeatedKinds: ["clarify-needed"],
        recurringReasons: ["Who is the intended audience?"],
        summary: "The memo audience is still underspecified.",
        keyQuestion: "Who is the intended audience?",
        missingResultContract: "The operator memo deliverable is still underspecified.",
        missingJudgingBasis: "The memo review basis is still underspecified.",
      }),
    );
    await writeJsonArtifact(
      getResearchBriefPath(projectRoot, consultationId),
      consultationResearchBriefSchema.parse({
        runId: consultationId,
        decision: "external-research-required",
        question: "What does the vendor documentation say?",
        researchPosture: "external-research-required",
        summary: "Vendor documentation is still required.",
        task: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        notes: [],
        signalSummary: [],
      }),
    );
    await writeJsonArtifact(
      getFailureAnalysisPath(projectRoot, consultationId),
      failureAnalysisSchema.parse({
        runId: consultationId,
        generatedAt: "2026-04-14T00:00:00.000Z",
        trigger: "no-survivors",
        summary: "Investigate before rerun.",
        recommendedAction: "investigate-root-cause-before-rerun",
        validationGaps: [],
        candidates: [],
      }),
    );
    await writePreflightReadinessArtifact(projectRoot, consultationId);

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(nestedCwd, consultationId, {
        hasExportedCandidate: false,
      }),
    );

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
    expect(parsed.clarifyFollowUpPath).toBe(getClarifyFollowUpPath(projectRoot, consultationId));
    expect(parsed.researchBriefPath).toBe(getResearchBriefPath(projectRoot, consultationId));
    expect(parsed.failureAnalysisPath).toBe(getFailureAnalysisPath(projectRoot, consultationId));
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
  });

  it("omits a valid crowning record when no candidate was exported", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-chat-native-stale-crown-");
    const consultationId = "run_20260409_stale_crown";

    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeJsonArtifact(
      getExportPlanPath(projectRoot, consultationId),
      exportPlanSchema.parse({
        runId: consultationId,
        winnerId: "cand-01",
        branchName: `orc/${consultationId}-cand-01`,
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        withReport: true,
        createdAt: "2026-04-14T00:00:00.000Z",
      }),
    );

    const parsed = consultToolResponseSchema.shape.artifacts.parse(
      buildConsultationArtifacts(projectRoot, consultationId, {
        hasExportedCandidate: false,
      }),
    );

    expect(parsed.crowningRecordPath).toBeUndefined();
  });
});
