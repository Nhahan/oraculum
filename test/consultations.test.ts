import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunManifestPath,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import {
  consultationProfileSelectionArtifactSchema,
  type ProfileRepoSignals,
} from "../src/domain/profile.js";
import {
  buildSavedConsultationStatus,
  consultationClarifyFollowUpSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
  type RunManifest,
} from "../src/domain/run.js";
import {
  deriveResearchSignalFingerprint,
  materializedTaskPacketSchema,
} from "../src/domain/task.js";
import { recommendConsultationPreflight } from "../src/services/consultation-preflight.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import { collectP3Evidence } from "../src/services/p3-evidence.js";
import { initializeProject, loadProjectConfigLayers } from "../src/services/project.js";
import { normalizePathForAssertion } from "./helpers/platform.js";

const tempRoots: string[] = [];
type ProfileSelectionFixture = {
  profileId: NonNullable<RunManifest["profileSelection"]>["validationProfileId"];
  confidence: NonNullable<RunManifest["profileSelection"]>["confidence"];
  source: NonNullable<RunManifest["profileSelection"]>["source"];
  summary: string;
  candidateCount: number;
  strategyIds: string[];
  oracleIds: string[];
  missingCapabilities: string[];
  signals: string[];
  validationProfileId?: NonNullable<RunManifest["profileSelection"]>["validationProfileId"];
  validationSummary?: string;
  validationSignals?: string[];
  validationGaps?: string[];
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

function toExpectedDisplayPath(cwd: string, targetPath: string): string {
  const normalizedRoot = normalizePathForAssertion(cwd).replace(/\/+$/u, "");
  const normalizedTarget = normalizePathForAssertion(targetPath);
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return normalizedTarget;
}

describe("consultation workflow summaries", () => {
  it("renders a richer consultation summary with entry paths and next steps", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library scripts and package export signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
        signals: ["package-export", "lint-script"],
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });
    await writeManifest(cwd, manifest);
    const profileSelection = manifest.profileSelection;
    if (!profileSelection) {
      throw new Error("expected persisted profile selection");
    }
    await writeProfileSelectionArtifact(cwd, manifest.id, profileSelection);
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, manifest.id),
      `# Finalist Comparison\n\n- Run: ${manifest.id}\n`,
      "utf8",
    );
    await writeFile(
      getWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 0,
          summary: "Judge selected cand-01.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          artifacts: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeExportPlanArtifact(cwd, manifest.id, "cand-01");

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Opened: 2026-04-04T00:00:00.000Z");
    expect(summary).toContain("Outcome: recommended-survivor");
    expect(summary).toContain("Outcome detail: Recommended survivor was selected.");
    expect(summary).toContain("Judging basis: Judged with repo-local validation oracles.");
    expect(summary).toContain("Research basis status: unknown");
    expect(summary).toContain("Validation posture: sufficient");
    expect(summary).toContain("Verification level: lightweight");
    expect(summary).toContain("Entry paths:");
    expect(summary).toContain("- consultation root: .oraculum/runs/run_1");
    expect(summary).toContain(
      "- profile selection: .oraculum/runs/run_1/reports/profile-selection.json",
    );
    expect(summary).toContain("- comparison report: .oraculum/runs/run_1/reports/comparison.md");
    expect(summary).toContain(
      "- winner selection: .oraculum/runs/run_1/reports/winner-selection.json",
    );
    expect(summary).toContain("- crowning record: .oraculum/runs/run_1/reports/export-plan.json");
    expect(summary).toContain("Auto validation posture: library (high, llm-recommendation)");
    expect(summary).toContain("Validation evidence: package-export, lint-script");
    expect(summary).toContain("Recommended survivor: cand-01 (high, llm-judge)");
    expect(summary).toContain("Next:");
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_1/reports/export-plan.json",
    );
    expect(summary).toContain("orc verdict archive");
    expect(summary).not.toContain("oraculum verdict");
  });

  it("renders pending consultations without completed artifacts", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("planned");
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Outcome: pending-execution");
    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- winner selection: not available yet");
    expect(summary).toContain("- crowning record: not created yet");
    expect(summary).toContain(`orc verdict ${manifest.id}`);
  });

  it("renders legacy survivor manifests that only persist the outcome survivor id", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: undefined,
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const archive = renderConsultationArchive([manifest]);

    expect(summary).toContain("Outcome: recommended-survivor");
    expect(summary).toContain("Recommended survivor: cand-01");
    expect(summary).toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(archive).toContain("survivor cand-01");
  });

  it("renders artifact-aware recommendation and crown guidance when the task targets a repo artifact", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          workspaceMode: "copy",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      "Recommended document result for docs/SESSION_PLAN.md: cand-01 (high, llm-judge)",
    );
    expect(summary).toContain(
      "- crown the recommended document result for docs/SESSION_PLAN.md: orc crown",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown");
  });

  it("renders summary header fields in a stable order when origin and artifact metadata are both present", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "tasks", "task.md"),
        originKind: "task-note",
        originPath: join(cwd, "notes", "seed.md"),
        artifactKind: "document",
        targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Task source: task-note (tasks/task.md)");
    expect(summary).toContain("Task origin: task-note (notes/seed.md)");
    expect(summary).toContain("Artifact kind: document");
    expect(summary).toContain("Target artifact: docs/SESSION_PLAN.md");
    expect(summary.indexOf("Task source: task-note (tasks/task.md)")).toBeLessThan(
      summary.indexOf("Task origin: task-note (notes/seed.md)"),
    );
    expect(summary.indexOf("Task origin: task-note (notes/seed.md)")).toBeLessThan(
      summary.indexOf("Artifact kind: document"),
    );
    expect(summary.indexOf("Artifact kind: document")).toBeLessThan(
      summary.indexOf("Target artifact: docs/SESSION_PLAN.md"),
    );
  });

  it("renders artifact-aware fallback wording when no recommended artifact result exists yet", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain(
      "No recommended document result for docs/SESSION_PLAN.md yet. Candidate states:",
    );
    expect(archive).toContain("no recommended document result for docs/SESSION_PLAN.md yet");
    expect(summary).not.toContain("No survivor yet. Candidate states:");
  });

  it("surfaces failure analysis artifacts in the consultation summary when investigation is recommended", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_failure_analysis",
      candidateCount: 1,
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getFailureAnalysisPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
          generatedAt: "2026-04-04T00:00:00.000Z",
          trigger: "no-survivors",
          summary:
            "No finalists survived the oracle rounds; investigate failing oracle evidence before retrying.",
          recommendedAction: "investigate-root-cause-before-rerun",
          validationGaps: [],
          candidates: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      "- failure analysis: .oraculum/runs/run_failure_analysis/reports/failure-analysis.json",
    );
    expect(summary).toContain(
      "- investigate the persisted failure analysis: .oraculum/runs/run_failure_analysis/reports/failure-analysis.json.",
    );
  });

  it("normalizes absolute artifact target paths in archive output when the project root is known", async () => {
    const cwd = await createInitializedProject();
    const absoluteTargetArtifactPath = join(cwd, "docs", "SESSION_PLAN.md");
    const manifest = createManifest("completed", {
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      },
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: join(cwd, "workspace", "cand-01"),
          taskPacketPath: join(cwd, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain(
      "No recommended document result for docs/SESSION_PLAN.md yet. Candidate states:",
    );
    expect(archive).toContain("artifact document @ docs/SESSION_PLAN.md");
    expect(archive).toContain("no recommended document result for docs/SESSION_PLAN.md yet");
    expect(archive).not.toContain(absoluteTargetArtifactPath);
  });

  it("preserves absolute artifact target paths outside the project root", async () => {
    const cwd = await createInitializedProject();
    const externalTargetArtifactPath = join(tmpdir(), "external", "SESSION_PLAN.md");
    const manifest = createManifest("completed", {
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: externalTargetArtifactPath,
      },
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: join(cwd, "workspace", "cand-01"),
          taskPacketPath: join(cwd, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain(
      `Target artifact: ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
    expect(archive).toContain(
      `artifact document @ ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
    expect(summary).not.toContain("../external/SESSION_PLAN.md");
    expect(archive).not.toContain("../external/SESSION_PLAN.md");
  });

  it("renders blocked preflight consultations with readiness guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target file and expected sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which file should Oraculum update, and what sections are required?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Preflight: needs-clarification (medium, repo-only)");
    expect(summary).toContain("Verification level: none");
    expect(summary).toContain(
      "No candidates were generated because execution stopped at preflight.",
    );
    expect(summary).not.toContain("Candidate states:");
    expect(summary).toContain(
      "Clarification needed: Which file should Oraculum update, and what sections are required?",
    );
    expect(summary).toContain(
      "- preflight readiness: .oraculum/runs/run_1/reports/preflight-readiness.json",
    );
    expect(summary).toContain(
      "- answer the preflight clarification question, then rerun `orc consult`.",
    );
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "review-preflight-readiness",
      "answer-clarification-and-rerun",
    ]);
    expect(status.validationGapsPresent).toBe(false);
    expect(status.taskSourceKind).toBe("task-note");
    expect(status.taskSourcePath).toBe("/tmp/task.md");
  });

  it("builds a machine-readable verdict review from saved consultation state", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "frontend",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework", "build-script"],
      },
      preflight: {
        decision: "proceed",
        confidence: "high",
        summary: "Repository evidence is sufficient to execute immediately.",
        researchPosture: "repo-only",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });
    await mkdir(join(cwd, ".oraculum", "runs", manifest.id, "reports"), { recursive: true });
    await writeFile(
      getWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 0,
          summary: "Judge selected cand-01.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          artifacts: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePreflightReadinessArtifact(cwd, manifest.id);
    const profileSelection = manifest.profileSelection;
    if (!profileSelection) {
      throw new Error("expected persisted profile selection");
    }
    await writeProfileSelectionArtifact(cwd, manifest.id, profileSelection);

    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
      comparisonMarkdownPath: "/tmp/run_1/reports/comparison.md",
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review).toEqual({
      outcomeType: "recommended-survivor",
      outcomeSummary: "Recommended survivor was selected.",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      judgingBasisSummary: "Judged with repo-local validation oracles.",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchBasisStatus: "unknown",
      researchSignalCount: 0,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      strongestEvidence: [
        "Frontend evidence is strongest.",
        "Validation evidence: frontend-framework",
        "Validation evidence: build-script",
        "cand-01 is the recommended promotion.",
      ],
      weakestEvidence: ["No e2e or visual deep check was detected."],
      secondOpinionTriggerKinds: [],
      secondOpinionTriggerReasons: [],
      recommendationSummary: "cand-01 is the recommended promotion.",
      manualReviewRecommended: false,
      manualCrowningCandidateIds: [],
      validationProfileId: "frontend",
      validationSummary: "Frontend evidence is strongest.",
      validationSignals: ["frontend-framework", "build-script"],
      validationGaps: ["No e2e or visual deep check was detected."],
      preflightDecision: "proceed",
      researchPosture: "repo-only",
      researchRerunRecommended: false,
      artifactAvailability: {
        preflightReadiness: true,
        clarifyFollowUp: false,
        researchBrief: false,
        failureAnalysis: false,
        profileSelection: true,
        comparisonReport: false,
        winnerSelection: true,
        secondOpinionWinnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });
  });

  it("renders clarify follow-up artifacts and replay guidance for repeated blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_clarify_follow_up",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The exact target artifact shape is still ambiguous.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);
    await writeFile(
      getClarifyFollowUpPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationClarifyFollowUpSchema.parse({
          runId: manifest.id,
          adapter: "codex",
          decision: "needs-clarification",
          scopeKeyType: "target-artifact",
          scopeKey: "docs/PRD.md",
          repeatedCaseCount: 3,
          repeatedKinds: ["clarify-needed", "external-research-required"],
          recurringReasons: [
            "Which sections must docs/PRD.md contain?",
            "What evidence is required before editing docs/PRD.md?",
          ],
          summary: "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
          keyQuestion:
            "What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
          missingResultContract:
            "A concrete section-level result contract for docs/PRD.md is still missing.",
          missingJudgingBasis:
            "The review basis does not yet say how to judge the completed PRD artifact.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      clarifyFollowUpPath: getClarifyFollowUpPath(cwd, manifest.id),
    });

    expect(summary).toContain("Clarify follow-up: target-artifact (docs/PRD.md, 3 prior cases)");
    expect(summary).toContain(
      "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
    );
    expect(summary).toContain(
      "Key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(summary).toContain(
      "Missing result contract: A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(summary).toContain(
      "Missing judging basis: The review basis does not yet say how to judge the completed PRD artifact.",
    );
    expect(summary).toContain(
      "- clarify follow-up: .oraculum/runs/run_clarify_follow_up/reports/clarify-follow-up.json",
    );
    expect(summary).toContain(
      "- inspect the persisted clarify follow-up: .oraculum/runs/run_clarify_follow_up/reports/clarify-follow-up.json.",
    );
    expect(summary).toContain(
      "- answer the key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(summary).toContain(
      "- rerun `orc consult` once the missing result contract and judging basis are explicit.",
    );
    expect(review.clarifyScopeKeyType).toBe("target-artifact");
    expect(review.clarifyScopeKey).toBe("docs/PRD.md");
    expect(review.clarifyRepeatedCaseCount).toBe(3);
    expect(review.clarifyFollowUpQuestion).toBe(
      "What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(review.clarifyMissingResultContract).toBe(
      "A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(review.clarifyMissingJudgingBasis).toBe(
      "The review basis does not yet say how to judge the completed PRD artifact.",
    );
    expect(review.artifactAvailability.clarifyFollowUp).toBe(true);
    expect(review.strongestEvidence).toContain(
      "Repeated blockers show the result contract is underspecified for docs/PRD.md.",
    );
    expect(review.strongestEvidence).toContain(
      "Key clarify question: What exact sections and acceptance bullets must docs/PRD.md contain before execution starts?",
    );
    expect(review.weakestEvidence).toContain(
      "Missing result contract: A concrete section-level result contract for docs/PRD.md is still missing.",
    );
    expect(review.weakestEvidence).toContain(
      "Missing judging basis: The review basis does not yet say how to judge the completed PRD artifact.",
    );
  });

  it("backfills and validates legacy verdict review aliases at the schema boundary", () => {
    const parsed = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
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
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "frontend",
      validationSignals: ["frontend-framework"],
      validationGaps: ["No build validation command was selected."],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(parsed.profileId).toBe("frontend");
    expect(parsed.profileMissingCapabilities).toEqual([
      "No build validation command was selected.",
    ]);

    expect(() =>
      verdictReviewSchema.parse({
        ...parsed,
        profileId: "library",
      }),
    ).toThrow("profileId must match validationProfileId");
  });

  it("backfills researchConflictHandling from persisted verdict review research signals", () => {
    const conflicted = verdictReviewSchema.parse({
      outcomeType: "external-research-required",
      verificationLevel: "none",
      validationPosture: "validation-gaps",
      judgingBasisKind: "missing-capability",
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 0,
      researchSummary: "External documentation still contains conflicting guidance.",
      researchRerunRecommended: true,
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchVersionNoteCount: 0,
      researchConflictCount: 1,
      researchConflictsPresent: true,
      validationSignals: [],
      validationGaps: [],
      researchPosture: "external-research-required",
      manualReviewRecommended: true,
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: true,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    const current = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "sufficient",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 1,
      researchSignalFingerprint: "fingerprint",
      researchRerunRecommended: false,
      researchSourceCount: 1,
      researchClaimCount: 1,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationSignals: [],
      validationGaps: [],
      researchPosture: "repo-plus-external-docs",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: true,
        failureAnalysis: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(conflicted.researchBasisStatus).toBe("current");
    expect(conflicted.researchConflictHandling).toBe("manual-review-required");
    expect(current.researchConflictHandling).toBe("accepted");
  });

  it("accepts reordered legacy verdict review gap aliases", () => {
    const parsed = verdictReviewSchema.parse({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
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
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "frontend",
      validationSignals: ["frontend-framework"],
      validationGaps: [
        "No build validation command was selected.",
        "No e2e or visual deep check was detected.",
      ],
      profileMissingCapabilities: [
        "No e2e or visual deep check was detected.",
        "No build validation command was selected.",
      ],
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: false,
        researchBrief: false,
        profileSelection: false,
        comparisonReport: false,
        winnerSelection: false,
        crowningRecord: false,
      },
      candidateStateCounts: {},
    });

    expect(parsed.validationGaps).toEqual([
      "No build validation command was selected.",
      "No e2e or visual deep check was detected.",
    ]);
    expect(parsed.profileMissingCapabilities).toEqual([
      "No e2e or visual deep check was detected.",
      "No build validation command was selected.",
    ]);
  });

  it("rejects recommended-survivor review payloads that omit the recommended candidate id", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
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
        finalistIds: ["cand-01"],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommendedCandidateId is required when outcomeType is recommended-survivor");
  });

  it("rejects review payloads whose finalist ids do not match survivor semantics", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
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
        recommendedCandidateId: "cand-01",
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommended-survivor reviews require at least one finalist id");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "standard",
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
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-02"],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommended-survivor reviews must include recommendedCandidateId in finalistIds");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
        verificationLevel: "standard",
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
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow(
      "finalistIds must match the number of promoted or exported candidate states when candidateStateCounts are present",
    );
  });

  it("rejects manual crowning ids that do not match finalists-without-recommendation reviews", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
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
        finalistIds: ["cand-01"],
        manualCrowningCandidateIds: ["cand-02"],
        manualReviewRecommended: true,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("manualCrowningCandidateIds must match finalistIds");
  });

  it("rejects manual crowning ids when manual review is not recommended", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
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
        finalistIds: ["cand-01"],
        manualCrowningCandidateIds: ["cand-01"],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("manualReviewRecommended must be true");
  });

  it("rejects manual crowning reasons without exposed manual crowning candidates", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        manualReviewRecommended: true,
        manualCrowningReason: "Operator review is required before crowning.",
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("manualCrowningReason is only allowed");
  });

  it("rejects finalists-without-recommendation reviews that do not recommend manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "finalists-without-recommendation",
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
        finalistIds: ["cand-01"],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("finalists-without-recommendation reviews must recommend manual review");
  });

  it("rejects validation-gap reviews that do not recommend manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "lightweight",
        validationPosture: "validation-gaps",
        judgingBasisKind: "missing-capability",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        manualReviewRecommended: false,
        validationGaps: ["No repo-local oracle was recorded."],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("completed-with-validation-gaps reviews must recommend manual review");
  });

  it("rejects recommended-survivor reviews that hide second-opinion disagreement without manual review", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-01"],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        secondOpinionAdapter: "claude-code",
        secondOpinionAgreement: "disagrees-select-vs-abstain",
        secondOpinionSummary:
          "Second-opinion judge abstained, while the primary path selected a finalist.",
        secondOpinionDecision: "abstain",
        secondOpinionTriggerKinds: ["many-changed-paths"],
        secondOpinionTriggerReasons: ["A finalist changed 3 paths, meeting the threshold."],
        manualReviewRecommended: false,
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: true,
          winnerSelection: true,
          secondOpinionWinnerSelection: true,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("recommended-survivor reviews must recommend manual review");
  });

  it("rejects verdict reviews whose outcome summary disagrees with the outcome and task context", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "recommended-survivor",
        outcomeSummary: "No recommended document result for docs/SESSION_PLAN.md emerged.",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "repo-local-oracle",
        judgingBasisSummary: "Judged with repo-local validation oracles.",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        taskArtifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: ["cand-01"],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {
          promoted: 1,
        },
      }),
    ).toThrow("outcomeSummary must match outcomeType and task artifact context");
  });

  it("rejects verdict reviews whose judging basis summary disagrees with the judging basis kind", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        outcomeSummary: "No survivors advanced after the oracle rounds.",
        verificationLevel: "lightweight",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        judgingBasisSummary: "Judged with repo-local validation oracles.",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("judgingBasisSummary must match judgingBasisKind");
  });

  it("rejects non-recommended review payloads that still include a recommended candidate id", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        recommendedCandidateId: "cand-01",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcomeType is recommended-survivor");
  });

  it("rejects non-finalist review payloads that still include finalist ids", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: ["cand-01"],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews require finalistIds to be empty");
  });

  it("rejects review payloads whose validation-gap semantics disagree with the outcome type", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: ["No build validation command was selected."],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews require validationGaps to be empty");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "completed-with-validation-gaps",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "missing-capability",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow(
      "completed-with-validation-gaps reviews require validationPosture to be validation-gaps",
    );

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "unknown",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("no-survivors reviews cannot use validation-gaps validationPosture");
  });

  it("rejects blocked-preflight review payloads whose validationPosture disagrees with the blocked state", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: true,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "external-research-required",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("external-research-required reviews require validationPosture to be validation-gaps");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "needs-clarification",
        verificationLevel: "none",
        validationPosture: "sufficient",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchPosture: "repo-only",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("needs-clarification reviews require validationPosture to be unknown");
  });

  it("rejects review payloads whose preflightDecision disagrees with the blocked outcome type", () => {
    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "no-survivors",
        verificationLevel: "none",
        validationPosture: "unknown",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        researchPosture: "repo-only",
        preflightDecision: "needs-clarification",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("preflightDecision needs-clarification requires outcomeType needs-clarification");

    expect(() =>
      verdictReviewSchema.parse({
        outcomeType: "external-research-required",
        verificationLevel: "none",
        validationPosture: "validation-gaps",
        judgingBasisKind: "unknown",
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        finalistIds: [],
        validationSignals: [],
        validationGaps: [],
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchSourceCount: 0,
        researchClaimCount: 0,
        researchVersionNoteCount: 0,
        researchConflictCount: 0,
        researchConflictsPresent: false,
        researchPosture: "external-research-required",
        preflightDecision: "proceed",
        artifactAvailability: {
          preflightReadiness: false,
          researchBrief: false,
          profileSelection: false,
          comparisonReport: false,
          winnerSelection: false,
          crowningRecord: false,
        },
        candidateStateCounts: {},
      }),
    ).toThrow("preflightDecision proceed cannot use a blocked preflight outcomeType");
  });

  it("allows legacy validation-gap reviews that only know the gap count", async () => {
    const manifest = createManifest("completed", {
      id: "run_gap_review",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "missing-capability",
      },
    });

    const review = await buildVerdictReview(manifest, {});

    expect(review.outcomeType).toBe("completed-with-validation-gaps");
    expect(review.validationGaps).toEqual([]);
    expect(review.recommendationAbsenceReason).toBe(
      "Execution completed with unresolved validation gaps.",
    );
    expect(review.manualReviewRecommended).toBe(true);
  });

  it("allows legacy survivor reviews that only know the recommended survivor id", async () => {
    const manifest = createManifest("completed", {
      id: "run_legacy_survivor_review",
      candidateCount: 1,
      rounds: [],
      candidates: [],
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });

    const review = verdictReviewSchema.parse(await buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("recommended-survivor");
    expect(review.recommendedCandidateId).toBe("cand-01");
    expect(review.finalistIds).toEqual(["cand-01"]);
    expect(review.manualReviewRecommended).toBe(false);
  });

  it("allows legacy finalists-without-recommendation reviews without invented finalist ids", async () => {
    const manifest = createManifest("completed", {
      id: "run_legacy_finalists_review",
      candidateCount: 2,
      rounds: [],
      candidates: [],
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 2,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });

    const review = verdictReviewSchema.parse(await buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("finalists-without-recommendation");
    expect(review.finalistIds).toEqual([]);
    expect(review.recommendationAbsenceReason).toBe(
      "Finalists survived, but no recommendation was recorded.",
    );
    expect(review.manualReviewRecommended).toBe(true);
  });

  it("reads judge abstention evidence into verdict review handoff fields", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_manual_crown_review",
      recommendedWinner: undefined,
      outcome: {
        type: "finalists-without-recommendation",
        terminal: true,
        crownable: false,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 0,
          summary: "Judge abstained.",
          recommendation: {
            decision: "abstain",
            confidence: "low",
            summary: "The finalists are too weak to recommend a safe promotion.",
          },
          artifacts: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const review = await buildVerdictReview(manifest, {
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review.recommendationAbsenceReason).toBe(
      "The finalists are too weak to recommend a safe promotion.",
    );
    expect(review.weakestEvidence).toContain(
      "The finalists are too weak to recommend a safe promotion.",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.manualCrowningCandidateIds).toEqual(["cand-01"]);
    expect(review.manualCrowningReason).toBe(
      "Finalists survived without a recorded recommendation; manual crowning requires operator judgment.",
    );
  });

  it("replays artifact-aware judging criteria from winner selection into verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_document_review",
      taskPacket: {
        id: "task",
        title: "Review PRD",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 best satisfies the PRD contract.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-04T00:00:00.000Z",
          completedAt: "2026-04-04T00:00:01.000Z",
          exitCode: 0,
          summary: "Judge selected cand-01.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is safest.",
            judgingCriteria: [
              "Covers the documented scope without contradicting repo constraints.",
              "Leaves the PRD internally consistent and reviewable.",
            ],
          },
          artifacts: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const review = await buildVerdictReview(manifest, {
      winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
    });

    expect(review.judgingCriteria).toEqual([
      "Covers the documented scope without contradicting repo constraints.",
      "Leaves the PRD internally consistent and reviewable.",
    ]);
  });

  it("surfaces second-opinion disagreement in verdict review and blocks direct crown guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_review",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
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

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain(
      "- second-opinion winner selection: .oraculum/runs/run_second_opinion_review/reports/winner-selection.second-opinion.json",
    );
    expect(summary).toContain("Second-opinion judge: claude-code (disagrees-select-vs-abstain)");
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(review.secondOpinionAdapter).toBe("claude-code");
    expect(review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
    expect(review.secondOpinionDecision).toBe("abstain");
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.weakestEvidence).toContain(
      "Second-opinion judge abstained, while the primary path selected a finalist.",
    );
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(true);
  });

  it("marks archive recommendations as manual review when second-opinion disagreement exists", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_archive",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
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

    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(archive).toContain(
      "- run_second_opinion_archive | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("surfaces second-opinion unavailability in verdict review and blocks direct crown guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_unavailable_review",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Second-opinion judge was unavailable, so manual review is still required.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain(
      "- second-opinion winner selection: .oraculum/runs/run_second_opinion_unavailable_review/reports/winner-selection.second-opinion.json",
    );
    expect(summary).toContain("Second-opinion judge: claude-code (unavailable)");
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(review.secondOpinionAdapter).toBe("claude-code");
    expect(review.secondOpinionAgreement).toBe("unavailable");
    expect(review.secondOpinionDecision).toBeUndefined();
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.weakestEvidence).toContain(
      "Second-opinion judge was unavailable, so manual review is still required.",
    );
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(true);
  });

  it("marks archive recommendations as manual review when second-opinion is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_unavailable_archive",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Second-opinion judge was unavailable, so manual review is still required.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(archive).toContain(
      "- run_second_opinion_unavailable_archive | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("keeps manual-review guidance visible after crowning when second-opinion is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_unavailable_crowned",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "failed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
            exitCode: 1,
            summary: "Second opinion was unavailable.",
            artifacts: [],
          },
          agreement: "unavailable",
          advisorySummary:
            "Second-opinion judge was unavailable, so manual review is still required.",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getExportPlanPath(cwd, manifest.id),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: manifest.id,
          winnerId: "cand-01",
          branchName: `orc/${manifest.id}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-04T00:00:02.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain("Second-opinion judge: claude-code (unavailable)");
    expect(summary).toContain(
      "- inspect the second-opinion judge before relying on the recommended result: .oraculum/runs/run_second_opinion_unavailable_crowned/reports/winner-selection.second-opinion.json.",
    );
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_second_opinion_unavailable_crowned/reports/export-plan.json",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.artifactAvailability.crowningRecord).toBe(true);
    expect(review.secondOpinionAgreement).toBe("unavailable");
    expect(archive).toContain(
      "- run_second_opinion_unavailable_crowned | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("keeps disagreeing second-opinion guidance visible after crowning", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_second_opinion_disagreement_crowned",
      outcome: {
        type: "recommended-survivor",
        finalistCount: 1,
        terminal: true,
        crownable: true,
        validationGapCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        judgingBasisKind: "repo-local-oracle",
        recommendedCandidateId: "cand-01",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended promotion.",
        source: "llm-judge",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "exported",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          runId: manifest.id,
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
            runId: manifest.id,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-04T00:00:00.000Z",
            completedAt: "2026-04-04T00:00:01.000Z",
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
    await writeFile(
      getExportPlanPath(cwd, manifest.id),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: manifest.id,
          winnerId: "cand-01",
          branchName: `orc/${manifest.id}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-04T00:00:02.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain("Second-opinion judge: claude-code (disagrees-select-vs-abstain)");
    expect(summary).toContain(
      "- inspect the second-opinion judge before relying on the recommended result: .oraculum/runs/run_second_opinion_disagreement_crowned/reports/winner-selection.second-opinion.json.",
    );
    expect(summary).toContain(
      "- perform manual review before materializing the recommended result.",
    );
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_second_opinion_disagreement_crowned/reports/export-plan.json",
    );
    expect(review.manualReviewRecommended).toBe(true);
    expect(review.artifactAvailability.crowningRecord).toBe(true);
    expect(review.secondOpinionAgreement).toBe("disagrees-select-vs-abstain");
    expect(archive).toContain(
      "- run_second_opinion_disagreement_crowned | completed | Task | no auto validation posture | recommended survivor cand-01 (manual review)",
    );
  });

  it("treats invalid clarify follow-up artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_clarify_follow_up",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The result contract is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);
    await writeFile(getClarifyFollowUpPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
        clarifyFollowUpPath: getClarifyFollowUpPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- clarify follow-up: not available");
    expect(summary).not.toContain(
      "- inspect the persisted clarify follow-up: .oraculum/runs/run_invalid_clarify_follow_up/reports/clarify-follow-up.json.",
    );
    expect(review.artifactAvailability.clarifyFollowUp).toBe(false);
    expect(review.clarifyScopeKeyType).toBeUndefined();
    expect(review.clarifyScopeKey).toBeUndefined();
    expect(review.clarifyRepeatedCaseCount).toBeUndefined();
    expect(review.clarifyFollowUpQuestion).toBeUndefined();
    expect(review.clarifyMissingResultContract).toBeUndefined();
    expect(review.clarifyMissingJudgingBasis).toBeUndefined();
  });

  it("treats invalid preflight-readiness artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_preflight_readiness",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The result contract is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "not-json\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- preflight readiness: not available");
    expect(review.artifactAvailability.preflightReadiness).toBe(false);
  });

  it("treats legacy preflight-readiness artifacts that omit runId as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_legacy_preflight_readiness",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The result contract is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getPreflightReadinessPath(cwd, manifest.id),
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
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Legacy preflight readiness remains usable.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- preflight readiness: not available");
    expect(review.artifactAvailability.preflightReadiness).toBe(false);
  });

  it("treats legacy research brief and profile selection artifacts that omit runId as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_legacy_research_profile",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      recommendedWinner: undefined,
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
      preflight: {
        decision: "external-research-required",
        confidence: "medium",
        summary: "Research is still required.",
        researchPosture: "repo-plus-external-docs",
        researchQuestion: "What do the official docs require?",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getResearchBriefPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question: "What do the official docs require?",
          confidence: "medium",
          researchPosture: "external-research-required",
          summary: "Legacy research brief remains parseable but should not be replayed.",
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
      getProfileSelectionPath(cwd, manifest.id),
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
            validationSummary: "Legacy profile selection remains parseable.",
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
            summary: "Legacy profile selection remains parseable.",
            validationSummary: "Legacy profile selection remains parseable.",
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

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        researchBriefPath: getResearchBriefPath(cwd, manifest.id),
        profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.researchBrief).toBe(false);
    expect(review.artifactAvailability.profileSelection).toBe(false);
    expect(review.researchRerunInputPath).toBeUndefined();
  });

  it("treats invalid second-opinion artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_second_opinion",
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getSecondOpinionWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        secondOpinionWinnerSelectionPath: getSecondOpinionWinnerSelectionPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- second-opinion winner selection: not available");
    expect(summary).toContain("- crown the recommended survivor: orc crown <branch-name>");
    expect(summary).not.toContain("Second-opinion judge:");
    expect(review.artifactAvailability.secondOpinionWinnerSelection).toBe(false);
    expect(review.secondOpinionAgreement).toBeUndefined();
    expect(review.secondOpinionAdapter).toBeUndefined();
    expect(review.secondOpinionSummary).toBeUndefined();
    expect(review.manualReviewRecommended).toBe(false);
  });

  it("treats invalid comparison reports as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_comparison_report",
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonJsonPath(cwd, manifest.id), "{}\n", "utf8");

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonJsonPath: getFinalistComparisonJsonPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("falls back to markdown when comparison json is malformed in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_json_with_markdown_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonJsonPath(cwd, manifest.id), "{\n", "utf8");
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, manifest.id),
      `# Finalist Comparison\n\n- Run: ${manifest.id}\n\nThe markdown report is still usable.\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonJsonPath: getFinalistComparisonJsonPath(cwd, manifest.id),
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain(
      `- comparison report: ${toExpectedDisplayPath(cwd, getFinalistComparisonMarkdownPath(cwd, manifest.id))}`,
    );
    expect(summary).not.toContain(
      toExpectedDisplayPath(cwd, getFinalistComparisonJsonPath(cwd, manifest.id)),
    );
    expect(review.artifactAvailability.comparisonReport).toBe(true);
  });

  it("does not report comparison availability from a missing markdown path alone", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_missing_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);

    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("treats blank comparison markdown as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_blank_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFinalistComparisonMarkdownPath(cwd, manifest.id), "   \n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("open the comparison report above");
    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("treats headerless comparison markdown as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_headerless_comparison_markdown",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, manifest.id),
      "# Finalist Comparison\n\nLegacy report without a run header.\n",
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        comparisonMarkdownPath: getFinalistComparisonMarkdownPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("open the comparison report above");
    expect(review.artifactAvailability.comparisonReport).toBe(false);
  });

  it("surfaces a valid comparison json path when markdown is unavailable", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_json_only_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getFinalistComparisonJsonPath(cwd, manifest.id),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId: manifest.id,
          generatedAt: "2026-04-04T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended survivor",
          finalistCount: 2,
          researchRerunRecommended: false,
          verificationLevel: "standard",
          finalists: [
            {
              candidateId: "cand-01",
              strategyLabel: "Minimal Change",
              summary: "cand-01 keeps the diff small.",
              artifactKinds: ["patch"],
              verdicts: [],
              changedPaths: ["docs/TASK.md"],
              changeSummary: {
                mode: "none",
                changedPathCount: 1,
                createdPathCount: 0,
                removedPathCount: 0,
                modifiedPathCount: 1,
              },
              witnessRollup: {
                witnessCount: 0,
                warningOrHigherCount: 0,
                repairableCount: 0,
                repairHints: [],
                riskSummaries: [],
                keyWitnesses: [],
              },
              repairSummary: {
                attemptCount: 0,
                repairedRounds: [],
              },
              status: "promoted",
              verdictCounts: {
                pass: 0,
                repairable: 0,
                fail: 0,
                skip: 0,
                info: 0,
                warning: 0,
                error: 0,
                critical: 0,
              },
            },
            {
              candidateId: "cand-02",
              strategyLabel: "Safety First",
              summary: "cand-02 carries broader safeguards.",
              artifactKinds: ["patch"],
              verdicts: [],
              changedPaths: ["docs/TASK.md"],
              changeSummary: {
                mode: "none",
                changedPathCount: 1,
                createdPathCount: 0,
                removedPathCount: 0,
                modifiedPathCount: 1,
              },
              witnessRollup: {
                witnessCount: 0,
                warningOrHigherCount: 0,
                repairableCount: 0,
                repairHints: [],
                riskSummaries: [],
                keyWitnesses: [],
              },
              repairSummary: {
                attemptCount: 0,
                repairedRounds: [],
              },
              status: "promoted",
              verdictCounts: {
                pass: 0,
                repairable: 0,
                fail: 0,
                skip: 0,
                info: 0,
                warning: 0,
                error: 0,
                critical: 0,
              },
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      `- comparison report: ${toExpectedDisplayPath(cwd, getFinalistComparisonJsonPath(cwd, manifest.id))}`,
    );
    expect(summary).toContain(
      "- inspect the comparison first. The shared `orc crown` path only crowns a recommended survivor.",
    );
  });

  it("does not tell operators to inspect a missing comparison report when finalists survived", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_missing_finalist_comparison",
      candidateCount: 2,
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/cand-01.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/cand-02.task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
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
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain(
      "- compare the surviving finalists manually before crowning because no comparison report is available yet.",
    );
    expect(summary).not.toContain("- inspect the comparison first.");
  });

  it("treats invalid winner-selection artifacts as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_winner_selection",
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
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "safety-first",
          strategyLabel: "Safety First",
          status: "promoted",
          workspaceDir: "/tmp/cand-02",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        winnerSelectionPath: getWinnerSelectionPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- winner selection: not available yet");
    expect(review.artifactAvailability.winnerSelection).toBe(false);
  });

  it("treats invalid failure-analysis artifacts as unavailable in summary and review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_failure_analysis",
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "failed",
          workspaceDir: "/tmp/cand-01",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getFailureAnalysisPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = verdictReviewSchema.parse(
      await buildVerdictReview(manifest, {
        failureAnalysisPath: getFailureAnalysisPath(cwd, manifest.id),
      }),
    );

    expect(summary).toContain("- failure analysis: not available");
    expect(summary).not.toContain(
      "- investigate the persisted failure analysis: .oraculum/runs/run_invalid_failure_analysis/reports/failure-analysis.json.",
    );
    expect(review.artifactAvailability.failureAnalysis).toBe(false);
  });

  it("renders blocked preflight consultations distinctly in the archive", async () => {
    const cwd = await createInitializedProject();
    const blocked = createManifest("completed", {
      id: "run_blocked",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target file is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which file should Oraculum update?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, blocked);

    const manifests = await listRecentConsultations(cwd, 10);
    const archive = renderConsultationArchive(manifests);

    expect(archive).toContain(
      "- run_blocked | completed | Task | no auto validation posture | needs clarification",
    );
  });

  it("renders external research preflight artifacts and writes a structured research brief", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Current versioned API behavior must be verified against official documentation.",
        researchPosture: "external-research-required",
        researchQuestion:
          "What does the official API documentation say about the current versioned behavior?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id);
    await writeFile(
      getResearchBriefPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
          runId: manifest.id,
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary:
            "Current versioned API behavior must be verified against official documentation.",
          task: manifest.taskPacket,
          notes: ["Official docs are required before proceeding."],
          signalSummary: ["language:javascript"],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);
    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      researchBriefPath: getResearchBriefPath(cwd, manifest.id),
    });

    expect(summary).toContain("Task source: task-note (");
    expect(summary).toContain("- research brief: .oraculum/runs/run_1/reports/research-brief.json");
    expect(summary).toContain(
      "Research needed: What does the official API documentation say about the current versioned behavior?",
    );
    expect(summary).toContain("- gather the required external evidence.");
    expect(summary).toContain(
      "- rerun from the persisted research brief when ready: `orc consult .oraculum/runs/run_1/reports/research-brief.json`.",
    );
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "review-preflight-readiness",
      "gather-external-research-and-rerun",
      "rerun-with-research-brief",
    ]);
    expect(status.taskSourceKind).toBe("task-note");
    expect(status.taskSourcePath).toBe("/tmp/task.md");
    expect(status.researchRerunRecommended).toBe(true);
    expect(status.researchRerunInputPath).toBeUndefined();
    expect(status.researchConflictsPresent).toBe(false);
    expect(status.validationGapsPresent).toBe(false);
    expect(review.researchPosture).toBe("external-research-required");
    expect(review.researchQuestion).toBe(
      "What does the official API documentation say about the current versioned behavior?",
    );
    expect(review.researchRerunRecommended).toBe(true);
    expect(review.researchRerunInputPath).toBe(getResearchBriefPath(cwd, manifest.id));
    expect(review.researchSourceCount).toBe(0);
    expect(review.researchClaimCount).toBe(0);
    expect(review.researchVersionNoteCount).toBe(0);
    expect(review.researchConflictCount).toBe(0);
    expect(review.taskSourceKind).toBe("task-note");
    expect(review.taskSourcePath).toBe("/tmp/task.md");
    expect(review.validationSignals).toEqual([]);
    expect(review.researchConflictsPresent).toBe(false);
    expect(review.artifactAvailability.researchBrief).toBe(true);
    expect(review.recommendationAbsenceReason).toBe(
      "Execution stopped because bounded external research is still required.",
    );
    expect(review.manualReviewRecommended).toBe(true);
  });

  it("does not surface an invalid persisted research brief as available rerun input", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_invalid_research_brief",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official API documentation is still required.",
        researchPosture: "external-research-required",
        researchQuestion:
          "What does the official API documentation say about the current versioned behavior?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "missing-capability",
      },
    });
    await writeManifest(cwd, manifest);
    await writePreflightReadinessArtifact(cwd, manifest.id, {
      recommendation: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official guidance is still required before execution.",
        researchPosture: "external-research-required",
        researchQuestion: "What official guidance is required before execution?",
      },
    });
    await writeFile(getResearchBriefPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      researchBriefPath: getResearchBriefPath(cwd, manifest.id),
    });

    expect(summary).toContain("- research brief: not available");
    expect(summary).not.toContain(
      "- rerun from the persisted research brief when ready: `orc consult .oraculum/runs/run_invalid_research_brief/reports/research-brief.json`.",
    );
    expect(review.researchRerunInputPath).toBeUndefined();
    expect(review.artifactAvailability.researchBrief).toBe(false);
  });

  it("writes a clarify follow-up artifact only after repeated same-scope blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const targetArtifactPath = "docs/PRD.md";
    const priorOne = createManifest("completed", {
      id: "run_clarify_prior_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_prior_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");
    const evidence = await collectP3Evidence(cwd);
    expect(evidence.clarifyPressure.promotionSignal.shouldPromote).toBe(true);
    expect(evidence.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath,
        occurrenceCount: 2,
      }),
    ]);

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_current", "reports"),
      runId: "run_clarify_current",
      taskPacket,
    });

    expect(result.preflight.decision).toBe("needs-clarification");
    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "target-artifact",
        scopeKey: targetArtifactPath,
        repeatedCaseCount: 2,
        repeatedKinds: expect.arrayContaining(["clarify-needed", "external-research-required"]),
        recurringReasons: expect.arrayContaining([
          "Which sections must the PRD contain?",
          "What should the PRD cover for this launch?",
        ]),
        priorQuestions: expect.arrayContaining([
          "Which sections must the PRD contain?",
          "What should the PRD cover for this launch?",
        ]),
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(await readFile(getClarifyFollowUpPath(cwd, "run_clarify_current"), "utf8")),
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(targetArtifactPath);
    expect(clarifyFollowUp.repeatedCaseCount).toBe(2);
    expect(clarifyFollowUp.repeatedKinds).toEqual(
      expect.arrayContaining(["clarify-needed", "external-research-required"]),
    );
    expect(clarifyFollowUp.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );
    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, "run_clarify_current"), "utf8"),
    ) as {
      clarifyFollowUp?: { keyQuestion?: string };
    };
    expect(readiness.clarifyFollowUp?.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );
  });

  it("matches repeated clarify pressure across relative and absolute in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const relativeTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = join(cwd, "docs", "PRD.md");
    const priorOne = createManifest("completed", {
      id: "run_clarify_mixed_target_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: relativeTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_mixed_target_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: absoluteTargetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        clarifyCalls += 1;
        return {
          runId: "run_clarify_mixed_target_current",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_mixed_target_current", "reports"),
      runId: "run_clarify_mixed_target_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_mixed_target_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(relativeTargetArtifactPath);
  });

  it("matches repeated clarify pressure across dotted and plain in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const dottedTargetArtifactPath = `./${normalizedTargetArtifactPath}`;
    const priorOne = createManifest("completed", {
      id: "run_clarify_dotted_target_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: normalizedTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_dotted_target_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: dottedTargetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: dottedTargetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        clarifyCalls += 1;
        return {
          runId: "run_clarify_dotted_target_current",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_dotted_target_current", "reports"),
      runId: "run_clarify_dotted_target_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_dotted_target_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTargetArtifactPath);
  });

  it("matches repeated clarify pressure across origin-backed relative and absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteOriginPath = join(cwd, normalizedTaskSourcePath);
    const priorOne = createManifest("completed", {
      id: "run_clarify_mixed_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: normalizedTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The operator memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended operator audience?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_mixed_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_mixed_source_2"),
        originKind: "task-note",
        originPath: absoluteOriginPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official operator guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which operator responsibilities are in scope?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: absoluteOriginPath,
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the operator memo.\n", "utf8");

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer memo audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer memo audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended operator audience?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the operator memo scope is underspecified.",
            keyQuestion: "Which operator audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete audience and deliverable contract.",
            missingJudgingBasis: "The review basis does not define how to judge the finished memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_mixed_source_current", "reports"),
      runId: "run_clarify_mixed_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: normalizedTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_mixed_source_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTaskSourcePath);
  });

  it("matches repeated clarify pressure across external absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const externalTaskSourcePath = join(tmpdir(), "oraculum-external-task-note.md");
    const priorOne = createManifest("completed", {
      id: "run_clarify_external_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: externalTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The external memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended audience for the external memo?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_external_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_source_2"),
        originKind: "task-note",
        originPath: externalTaskSourcePath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official external guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which external audience and responsibilities are in scope?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the external operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: externalTaskSourcePath,
      },
    });
    await writeFile(
      taskPacket.source.path,
      "# Task\nPrepare the external operator memo.\n",
      "utf8",
    );

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended audience for the external memo?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the external memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the external memo scope is underspecified.",
            keyQuestion: "Which external audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete external audience and deliverable contract.",
            missingJudgingBasis:
              "The review basis does not define how to judge the finished external memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_external_source_current", "reports"),
      runId: "run_clarify_external_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: externalTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_external_source_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(externalTaskSourcePath);
  });

  it("matches repeated clarify pressure across external relative and absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const externalRelativeTaskSourcePath = "../oraculum-external-task-note.md";
    const externalAbsoluteTaskSourcePath = join(cwd, externalRelativeTaskSourcePath);
    const priorOne = createManifest("completed", {
      id: "run_clarify_external_mixed_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: externalRelativeTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The external memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended audience for the external memo?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_external_mixed_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_mixed_source_2"),
        originKind: "task-note",
        originPath: externalAbsoluteTaskSourcePath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official external guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which external audience and responsibilities are in scope?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the external operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: externalAbsoluteTaskSourcePath,
      },
    });
    await writeFile(
      taskPacket.source.path,
      "# Task\nPrepare the external operator memo.\n",
      "utf8",
    );

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended audience for the external memo?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the external memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the external memo scope is underspecified.",
            keyQuestion: "Which external audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete external audience and deliverable contract.",
            missingJudgingBasis:
              "The review basis does not define how to judge the finished external memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(
        cwd,
        ".oraculum",
        "runs",
        "run_clarify_external_mixed_source_current",
        "reports",
      ),
      runId: "run_clarify_external_mixed_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: externalAbsoluteTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(
          getClarifyFollowUpPath(cwd, "run_clarify_external_mixed_source_current"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(externalAbsoluteTaskSourcePath);
  });

  it("prefers repeated target-artifact pressure when both target and source scopes repeat", async () => {
    const cwd = await createInitializedProject();
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = join(cwd, normalizedTargetArtifactPath);
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteTaskSourcePath = join(cwd, normalizedTaskSourcePath);

    const priorOne = createManifest("completed", {
      id: "run_clarify_both_axes_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: normalizedTaskSourcePath,
        artifactKind: "document",
        targetArtifactPath: normalizedTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD contract is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    const priorTwo = createManifest("completed", {
      id: "run_clarify_both_axes_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_both_axes_2"),
        originKind: "task-note",
        originPath: absoluteTaskSourcePath,
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: absoluteTargetArtifactPath,
      source: {
        kind: "task-note",
        path: absoluteTaskSourcePath,
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_both_axes_current", "reports"),
      runId: "run_clarify_both_axes_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "target-artifact",
        scopeKey: normalizedTargetArtifactPath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_both_axes_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTargetArtifactPath);
  });

  it("does not write a clarify follow-up artifact for a first-time blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: "docs/PRD.md",
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        clarifyCalls += 1;
        throw new Error("should not run");
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_first", "reports"),
      runId: "run_clarify_first",
      taskPacket,
    });

    expect(clarifyCalls).toBe(0);
    await expect(
      readFile(getClarifyFollowUpPath(cwd, "run_clarify_first"), "utf8"),
    ).rejects.toThrow();
  });

  it("falls back to needs-clarification for vague low-contract tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = materializedTaskPacketSchema.parse({
      id: "ambiguous-release-guidance",
      title: "ambiguous release guidance",
      intent: [
        "Improve the release guidance so it is better and more complete.",
        "",
        "Notes:",
        "- Keep the change small.",
        "- Use the right artifact if one should change.",
        "- Make the result obviously better for operators.",
      ].join("\n"),
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: join(cwd, "dogfood-tasks", "ambiguous-release-guidance.md"),
      },
    });
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    await writeFile(taskPacket.source.path, `${taskPacket.intent}\n`, "utf8");

    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "timed-out",
          startedAt: "2026-04-15T00:00:00.000Z",
          completedAt: "2026-04-15T00:00:45.000Z",
          exitCode: 0,
          summary: "Timed out before returning structured output.",
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        throw new Error("not used");
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_ambiguous_timeout", "reports"),
      runId: "run_ambiguous_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "needs-clarification",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. The task still lacks a concrete target artifact or result contract for safe execution.",
      researchPosture: "repo-only",
      clarificationQuestion:
        "Which file or artifact should Oraculum update, and what concrete result should it produce?",
    });
  });

  it("falls back to external-research-required for official current-version doc tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = materializedTaskPacketSchema.parse({
      id: "external-doc-alignment",
      title: "external doc alignment",
      intent: [
        "Document whether the current Oraculum docs match the latest official OpenAI guidance for structured tool output and prompt-based JSON schema generation.",
        "",
        "Target outcome:",
        "- If repo-only evidence is enough, proceed conservatively.",
        "- If repo-only evidence is insufficient, do not guess. Require bounded external research and preserve a reusable research artifact.",
      ].join("\n"),
      nonGoals: [],
      acceptanceCriteria: [],
      risks: ["Prefer explicit research over speculation."],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: join(cwd, "dogfood-tasks", "external-doc-alignment.md"),
      },
    });
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    await writeFile(taskPacket.source.path, `${taskPacket.intent}\n`, "utf8");

    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "timed-out",
          startedAt: "2026-04-15T00:00:00.000Z",
          completedAt: "2026-04-15T00:00:45.000Z",
          exitCode: 0,
          summary: "Timed out before returning structured output.",
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        throw new Error("not used");
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_external_doc_timeout", "reports"),
      runId: "run_external_doc_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "external-research-required",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. Official current-version documentation is still required before safe execution.",
      researchPosture: "external-research-required",
      researchQuestion:
        "What do the official current-version docs say about the requested behavior or guidance?",
    });
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(
        await readFile(getResearchBriefPath(cwd, "run_external_doc_timeout"), "utf8"),
      ) as unknown,
    );
    expect(researchBrief.question).toBe(
      "What do the official current-version docs say about the requested behavior or guidance?",
    );
  });

  it("renders research-brief task provenance in summary and review", async () => {
    const cwd = await createInitializedProject();
    const originalTaskPath = "/tmp/original-task.md";
    const targetArtifactPath = "docs/SESSION_PLAN.md";
    const manifest = createManifest("completed", {
      taskPath: getResearchBriefPath(cwd, "run_source"),
      preflight: {
        decision: "proceed",
        confidence: "medium",
        summary:
          "Repository evidence is sufficient to proceed with the persisted research context.",
        researchPosture: "repo-plus-external-docs",
        researchBasisDrift: true,
      },
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_source"),
        artifactKind: "document",
        targetArtifactPath,
        researchContext: {
          question: "What does the official API documentation say about the current behavior?",
          summary: "Review the official versioned API docs before execution.",
          confidence: "medium",
          signalSummary: ["language:javascript"],
          signalFingerprint: deriveResearchSignalFingerprint(["language:javascript"]),
          sources: [
            {
              kind: "official-doc",
              title: "Current API docs",
              locator: "https://example.com/docs/current-api",
            },
          ],
          claims: [
            {
              statement: "The current API requires a version header on session refresh.",
              sourceLocators: ["https://example.com/docs/current-api"],
            },
          ],
          versionNotes: ["Behavior changed in v3.2 compared with the legacy session API."],
          unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
          conflictHandling: "manual-review-required",
        },
        originKind: "task-note",
        originPath: originalTaskPath,
      },
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {});
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain(
      "Task source: research-brief (.oraculum/runs/run_source/reports/research-brief.json)",
    );
    expect(summary).toContain("Artifact kind: document");
    expect(summary).toContain("Target artifact: docs/SESSION_PLAN.md");
    expect(summary).toContain("Research signal basis: 1");
    expect(summary).toContain(
      `Research signal fingerprint: ${deriveResearchSignalFingerprint(["language:javascript"])}`,
    );
    expect(summary).toContain("Research basis drift: detected");
    expect(summary).toContain(
      "- refresh the persisted external research because its signal basis no longer matches the current repository.",
    );
    expect(summary).toContain(
      "- rerun from the persisted research brief after refreshing evidence: `orc consult .oraculum/runs/run_source/reports/research-brief.json`.",
    );
    expect(summary).toContain("Task origin: task-note (");
    expect(status.taskSourceKind).toBe("research-brief");
    expect(status.taskSourcePath).toBe(getResearchBriefPath(cwd, "run_source"));
    expect(status.taskArtifactKind).toBe("document");
    expect(status.targetArtifactPath).toBe(targetArtifactPath);
    expect(status.validationProfileId).toBeUndefined();
    expect(status.validationSignals).toEqual([]);
    expect(status.validationGaps).toEqual([]);
    expect(status.researchRerunRecommended).toBe(true);
    expect(status.researchRerunInputPath).toBe(getResearchBriefPath(cwd, "run_source"));
    expect(status.researchConfidence).toBe("medium");
    expect(status.researchSignalCount).toBe(1);
    expect(status.researchSignalFingerprint).toBe(
      deriveResearchSignalFingerprint(["language:javascript"]),
    );
    expect(status.researchBasisDrift).toBe(true);
    expect(status.researchConflictsPresent).toBe(true);
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
      "refresh-stale-research-and-rerun",
    ]);
    expect(status.taskOriginSourceKind).toBe("task-note");
    expect(status.taskOriginSourcePath).toBe(originalTaskPath);
    expect(review.taskSourceKind).toBe("research-brief");
    expect(review.taskSourcePath).toBe(getResearchBriefPath(cwd, "run_source"));
    expect(review.taskArtifactKind).toBe("document");
    expect(review.targetArtifactPath).toBe(targetArtifactPath);
    expect(review.researchSummary).toBe("Review the official versioned API docs before execution.");
    expect(review.researchConfidence).toBe("medium");
    expect(review.researchSignalCount).toBe(1);
    expect(review.researchSignalFingerprint).toBe(
      deriveResearchSignalFingerprint(["language:javascript"]),
    );
    expect(review.researchBasisDrift).toBe(true);
    expect(review.researchRerunRecommended).toBe(true);
    expect(review.researchRerunInputPath).toBe(getResearchBriefPath(cwd, "run_source"));
    expect(review.researchSourceCount).toBe(1);
    expect(review.researchClaimCount).toBe(1);
    expect(review.researchVersionNoteCount).toBe(1);
    expect(review.researchConflictCount).toBe(1);
    expect(review.researchConflictsPresent).toBe(true);
    expect(review.taskOriginSourceKind).toBe("task-note");
    expect(review.taskOriginSourcePath).toBe(originalTaskPath);
    expect(review.validationSignals).toEqual([]);
    expect(review.weakestEvidence).toContain(
      "Persisted research evidence no longer matches the current repository signal basis.",
    );
    expect(review.weakestEvidence).toContain("External research contains unresolved conflicts.");
  });

  it("does not report a promotion record when only a stale export plan file exists", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeExportPlanArtifact(cwd, manifest.id, "cand-01");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });

    expect(summary).toContain("- crowning record: not created yet");
    expect(summary).not.toContain("- reopen the crowning record:");
    expect(review.artifactAvailability.crowningRecord).toBe(false);
  });

  it("does not claim a profile-selection artifact when the file is missing", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library scripts and package export signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
        signals: ["package-export", "lint-script"],
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- profile selection: not available");
  });

  it("does not claim a profile-selection artifact when the file is invalid", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library scripts and package export signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
        signals: ["package-export", "lint-script"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getProfileSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain("- profile selection: not available");
    expect(review.artifactAvailability.profileSelection).toBe(false);
  });

  it("does not surface skipped profile commands from a stale mismatched profile-selection artifact", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "generic",
        confidence: "low",
        source: "fallback-detection",
        summary: "No executable profile-specific command evidence was detected.",
        candidateCount: 3,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: [],
        missingCapabilities: ["No repo-local validation command was detected."],
        signals: ["e2e-config"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getProfileSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationProfileSelectionArtifactSchema.parse({
          runId: "run_other",
          signals: {
            packageManager: "unknown",
            scripts: [],
            dependencies: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [
              {
                id: "e2e-deep",
                label: "End-to-end or visual checks",
                capability: "e2e-or-visual",
                reason: "missing-explicit-command",
                detail:
                  "Test-runner evidence was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
              },
            ],
          },
          recommendation: {
            validationProfileId: "generic",
            confidence: "low",
            validationSummary: "No executable profile-specific command evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change", "safety-first"],
            selectedCommandIds: [],
            validationGaps: ["No repo-local validation command was detected."],
          },
          appliedSelection: {
            profileId: "generic",
            validationProfileId: "generic",
            confidence: "low",
            source: "fallback-detection",
            validationSummary: "No executable profile-specific command evidence was detected.",
            summary: "No executable profile-specific command evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change", "safety-first"],
            oracleIds: [],
            missingCapabilities: ["No repo-local validation command was detected."],
            validationGaps: ["No repo-local validation command was detected."],
            signals: ["e2e-config"],
            validationSignals: ["e2e-config"],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      profileSelectionPath: getProfileSelectionPath(cwd, manifest.id),
    });

    expect(summary).toContain("- profile selection: not available");
    expect(summary).not.toContain("Skipped validation posture commands:");
    expect(review.artifactAvailability.profileSelection).toBe(false);
  });

  it("does not claim a crowning record when the export plan file is invalid", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed");
    await writeManifest(cwd, manifest);
    await writeFile(getExportPlanPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = await buildVerdictReview(manifest, {
      crowningRecordPath: getExportPlanPath(cwd, manifest.id),
    });

    expect(summary).toContain("- crowning record: not created yet");
    expect(review.artifactAvailability.crowningRecord).toBe(false);
  });

  it("shows profile gaps in the consultation summary when deep validation is incomplete", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      rounds: [
        {
          id: "fast",
          label: "Fast",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "impact",
          label: "Impact",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "deep",
          label: "Deep",
          status: "completed",
          verdictCount: 1,
          survivorCount: 1,
          eliminatedCount: 0,
        },
      ],
      profileSelection: {
        profileId: "frontend",
        confidence: "medium",
        source: "fallback-detection",
        summary: "Frontend signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: ["lint-fast", "typecheck-fast", "build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework", "build-script"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getProfileSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Outcome: finalists-without-recommendation");
    expect(summary).toContain("Validation posture: validation-gaps");
    expect(summary).toContain("Verification level: standard");
    expect(summary).toContain("Validation evidence: frontend-framework, build-script");
    expect(summary).toContain("Validation gaps from the selected posture:");
    expect(summary).toContain("- No e2e or visual deep check was detected.");
    expect(status.verificationLevel).toBe("standard");
    expect(status.validationProfileId).toBe("frontend");
    expect(status.validationSummary).toBe("Frontend signals are strongest.");
    expect(status.validationSignals).toEqual(["frontend-framework", "build-script"]);
    expect(status.validationGaps).toEqual(["No e2e or visual deep check was detected."]);
    expect(status.researchRerunRecommended).toBe(false);
    expect(status.researchRerunInputPath).toBeUndefined();
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
      "review-validation-gaps",
      "add-repo-local-oracle",
    ]);
  });

  it("shows skipped profile commands from the profile-selection artifact", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "generic",
        confidence: "low",
        source: "fallback-detection",
        summary: "No executable profile-specific command evidence was detected.",
        candidateCount: 3,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: [],
        missingCapabilities: ["No repo-local validation command was detected."],
        signals: ["e2e-config"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getProfileSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationProfileSelectionArtifactSchema.parse({
          runId: manifest.id,
          signals: {
            packageManager: "unknown",
            scripts: [],
            dependencies: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [
              {
                id: "e2e-deep",
                label: "End-to-end or visual checks",
                capability: "e2e-or-visual",
                reason: "missing-explicit-command",
                detail:
                  "Test-runner evidence was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
              },
            ],
          },
          recommendation: {
            validationProfileId: "generic",
            confidence: "low",
            validationSummary: "No executable profile-specific command evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change", "safety-first"],
            selectedCommandIds: [],
            validationGaps: ["No repo-local validation command was detected."],
          },
          appliedSelection: {
            validationProfileId: "generic",
            confidence: "low",
            source: "fallback-detection",
            validationSummary: "No executable profile-specific command evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change", "safety-first"],
            oracleIds: [],
            validationGaps: ["No repo-local validation command was detected."],
            validationSignals: ["e2e-config"],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Skipped validation posture commands:");
    expect(summary).toContain(
      "- e2e-deep: missing-explicit-command - Test-runner evidence was detected",
    );
  });

  it("does not suggest manual promotion when no finalists survived", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("No survivor yet. Candidate states:");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("oraculum crown");
    expect(status.verificationLevel).toBe("lightweight");
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("lists recent consultations in descending order", async () => {
    const cwd = await createInitializedProject();
    const older = createManifest("completed", {
      id: "run_older",
      createdAt: "2026-04-03T00:00:00.000Z",
    });
    const newer = createManifest("planned", {
      id: "run_newer",
      createdAt: "2026-04-04T00:00:00.000Z",
    });
    await writeManifest(cwd, older);
    await writeManifest(cwd, newer);

    const manifests = await listRecentConsultations(cwd, 10);
    const archive = renderConsultationArchive(manifests);

    expect(manifests.map((manifest) => manifest.id)).toEqual(["run_newer", "run_older"]);
    expect(archive).toContain("Recent consultations:");
    expect(archive).toContain(
      "- run_newer | planned | Task | no auto validation posture | pending execution",
    );
    expect(archive).toContain(
      "- run_older | completed | Task | no auto validation posture | finalists without recommendation",
    );
    expect(archive).toContain("orc verdict run_newer");
  });

  it("renders distinct terminal archive summaries for finalists without recommendation and validation gaps", async () => {
    const cwd = await createInitializedProject();
    const finalists = createManifest("completed", {
      id: "run_finalists",
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace-a",
          taskPacketPath: "/tmp/task-packet-a.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    const validationGaps = createManifest("completed", {
      id: "run_gaps",
      candidates: [
        {
          id: "cand-02",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: "/tmp/workspace-b",
          taskPacketPath: "/tmp/task-packet-b.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      profileSelection: {
        profileId: "frontend",
        confidence: "medium",
        source: "fallback-detection",
        summary: "Frontend signals are strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: ["build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework"],
      },
    });
    await writeManifest(cwd, finalists);
    await writeManifest(cwd, validationGaps);

    const archive = renderConsultationArchive(await listRecentConsultations(cwd, 10));

    expect(archive).toContain(
      "- run_finalists | completed | Task | no auto validation posture | finalists without recommendation",
    );
    expect(archive).toContain(
      "- run_gaps | completed | Task | validation posture frontend | completed with validation gaps",
    );
  });

  it("renders artifact metadata in archive entries when the task packet carries it", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("planned", {
      id: "run_artifact",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      },
    });
    await writeManifest(cwd, manifest);

    const archive = renderConsultationArchive(await listRecentConsultations(cwd, 10));

    expect(archive).toContain(
      "- run_artifact | planned | Task | artifact document @ docs/SESSION_PLAN.md | no auto validation posture | pending execution",
    );
  });

  it("keeps legacy manifests without candidateCount visible in recent consultation listings", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_legacy",
      createdAt: "2026-04-05T00:00:00.000Z",
    });
    const { candidateCount: _candidateCount, ...legacyManifest } = manifest;
    await writeRawManifest(cwd, manifest.id, legacyManifest);

    const manifests = await listRecentConsultations(cwd, 10);

    expect(manifests).toEqual([
      expect.objectContaining({
        id: "run_legacy",
        candidateCount: 1,
        updatedAt: "2026-04-05T00:00:00.000Z",
        outcome: expect.objectContaining({
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
        }),
      }),
    ]);
  });

  it("renders chat-native next steps with the orc prefix", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd, {
      surface: "chat-native",
    });
    const archive = renderConsultationArchive([manifest], {
      surface: "chat-native",
    });

    expect(summary).toContain("orc crown <branch-name>");
    expect(summary).toContain("orc verdict");
    expect(summary).toContain("orc verdict archive");
    expect(summary).not.toContain("oraculum crown");
    expect(archive).toContain(`orc verdict ${manifest.id}`);
    expect(archive).not.toContain("oraculum verdict");
  });

  it("renders bare crown guidance for non-git workspace-sync survivors", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          workspaceMode: "copy",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd, {
      surface: "chat-native",
    });

    expect(summary).toContain("- crown the recommended survivor: orc crown");
    expect(summary).not.toContain("orc crown <branch-name>");
  });

  it("reports thorough verification when deep coverage completed without gaps", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      rounds: [
        {
          id: "fast",
          label: "Fast",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "impact",
          label: "Impact",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "deep",
          label: "Deep",
          status: "completed",
          verdictCount: 1,
          survivorCount: 1,
          eliminatedCount: 0,
        },
      ],
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library validation coverage is explicit.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast", "unit-impact", "full-suite-deep"],
        missingCapabilities: [],
        signals: ["library"],
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Verification level: thorough");
    expect(status.verificationLevel).toBe("thorough");
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(cwd);
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function writeManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", manifest.id), { recursive: true });
  await mkdir(join(cwd, ".oraculum", "runs", manifest.id, "reports"), { recursive: true });
  await writeFile(
    getRunManifestPath(cwd, manifest.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeRawManifest(cwd: string, runId: string, manifest: unknown): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId), { recursive: true });
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(getRunManifestPath(cwd, runId), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeProfileSelectionArtifact(
  cwd: string,
  runId: string,
  profileSelection: NonNullable<RunManifest["profileSelection"]>,
): Promise<void> {
  const signals: ProfileRepoSignals = {
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
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getProfileSelectionPath(cwd, runId),
    `${JSON.stringify(
      consultationProfileSelectionArtifactSchema.parse({
        runId,
        signals,
        recommendation: {
          validationProfileId: profileSelection.validationProfileId,
          confidence: profileSelection.confidence,
          validationSummary: profileSelection.validationSummary,
          candidateCount: profileSelection.candidateCount,
          strategyIds: profileSelection.strategyIds,
          selectedCommandIds: [],
          validationGaps: profileSelection.validationGaps,
        },
        appliedSelection: profileSelection,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writePreflightReadinessArtifact(
  cwd: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getPreflightReadinessPath(cwd, runId),
    `${JSON.stringify(
      consultationPreflightReadinessArtifactSchema.parse({
        runId,
        signals: {
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
        },
        recommendation: {
          decision: "proceed",
          confidence: "low",
          summary: "Proceed conservatively with the default consultation flow.",
          researchPosture: "repo-only",
        },
        ...overrides,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function writeExportPlanArtifact(
  cwd: string,
  runId: string,
  winnerId: string,
): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(
    getExportPlanPath(cwd, runId),
    `${JSON.stringify(
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
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function createManifest(
  status: "planned" | "completed",
  overrides: Partial<Omit<RunManifest, "profileSelection">> & {
    profileSelection?: ProfileSelectionFixture;
  } = {},
): RunManifest {
  const { profileSelection: rawProfileSelection, ...restOverrides } = overrides;
  const profileSelection = rawProfileSelection
    ? {
        ...rawProfileSelection,
        validationProfileId:
          rawProfileSelection.validationProfileId ?? rawProfileSelection.profileId,
        validationSummary: rawProfileSelection.validationSummary ?? rawProfileSelection.summary,
        validationSignals: rawProfileSelection.validationSignals ?? rawProfileSelection.signals,
        validationGaps:
          rawProfileSelection.validationGaps ?? rawProfileSelection.missingCapabilities,
      }
    : undefined;

  return {
    id: "run_1",
    status,
    taskPath: "/tmp/task.md",
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: "task-note",
      sourcePath: "/tmp/task.md",
    },
    agent: "codex",
    candidateCount: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [
      {
        id: "fast",
        label: "Fast",
        status: status === "completed" ? "completed" : "pending",
        verdictCount: status === "completed" ? 1 : 0,
        survivorCount: status === "completed" ? 1 : 0,
        eliminatedCount: 0,
      },
    ],
    candidates: [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: status === "completed" ? "exported" : "planned",
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
    ...restOverrides,
    ...(profileSelection ? { profileSelection } : {}),
  };
}
