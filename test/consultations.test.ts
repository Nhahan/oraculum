import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunManifestPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import {
  buildSavedConsultationStatus,
  consultationResearchBriefSchema,
  type RunManifest,
} from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import { initializeProject } from "../src/services/project.js";

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
    await writeFile(getProfileSelectionPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(getFinalistComparisonMarkdownPath(cwd, manifest.id), "# comparison\n", "utf8");
    await writeFile(getWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(getExportPlanPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Opened: 2026-04-04T00:00:00.000Z");
    expect(summary).toContain("Outcome: recommended-survivor");
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
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "{}\n", "utf8");

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

    const review = buildVerdictReview(manifest, {
      preflightReadinessPath: "/tmp/run_1/reports/preflight-readiness.json",
      profileSelectionPath: "/tmp/run_1/reports/profile-selection.json",
      comparisonMarkdownPath: "/tmp/run_1/reports/comparison.md",
      winnerSelectionPath: "/tmp/run_1/reports/winner-selection.json",
    });

    expect(review).toEqual({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchSourceCount: 0,
      researchClaimCount: 0,
      researchVersionNoteCount: 0,
      researchConflictCount: 0,
      researchConflictsPresent: false,
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "frontend",
      validationSummary: "Frontend evidence is strongest.",
      validationSignals: ["frontend-framework", "build-script"],
      validationGaps: ["No e2e or visual deep check was detected."],
      preflightDecision: "proceed",
      researchPosture: "repo-only",
      researchRerunRecommended: false,
      artifactAvailability: {
        preflightReadiness: true,
        researchBrief: false,
        profileSelection: true,
        comparisonReport: true,
        winnerSelection: true,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });
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

  it("allows legacy validation-gap reviews that only know the gap count", () => {
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

    const review = buildVerdictReview(manifest, {});

    expect(review.outcomeType).toBe("completed-with-validation-gaps");
    expect(review.validationGaps).toEqual([]);
  });

  it("allows legacy survivor reviews that only know the recommended survivor id", () => {
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

    const review = verdictReviewSchema.parse(buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("recommended-survivor");
    expect(review.recommendedCandidateId).toBe("cand-01");
    expect(review.finalistIds).toEqual(["cand-01"]);
  });

  it("allows legacy finalists-without-recommendation reviews without invented finalist ids", () => {
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

    const review = verdictReviewSchema.parse(buildVerdictReview(manifest, {}));

    expect(review.outcomeType).toBe("finalists-without-recommendation");
    expect(review.finalistIds).toEqual([]);
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
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(
      getResearchBriefPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
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
    const review = buildVerdictReview(manifest, {
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
        },
        originKind: "task-note",
        originPath: originalTaskPath,
      },
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = buildVerdictReview(manifest, {});
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
    await writeFile(getExportPlanPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- crowning record: not created yet");
    expect(summary).not.toContain("- reopen the crowning record:");
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
        {
          signals: {
            packageManager: "unknown",
            skippedCommandCandidates: [
              {
                id: "e2e-deep",
                label: "End-to-end or visual checks",
                capability: "e2e-or-visual",
                reason: "missing-explicit-command",
                detail:
                  "A test-runner capability was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Skipped validation posture commands:");
    expect(summary).toContain(
      "- e2e-deep: missing-explicit-command - A test-runner capability was detected",
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
    expect(summary).toContain(
      "- review why no candidate survived the oracle rounds: open the comparison report above.",
    );
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
