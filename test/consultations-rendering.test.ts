import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonMarkdownPath,
  getProfileSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { consultationProfileSelectionArtifactSchema } from "../src/domain/profile.js";
import { buildSavedConsultationStatus } from "../src/domain/run.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import {
  createInitializedProject,
  createManifest,
  createTaskPacketFixture,
  registerConsultationsTempRootCleanup,
  writeExportPlanArtifact,
  writeManifest,
  writePreflightReadinessArtifact,
  writeProfileSelectionArtifact,
  writeRawManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation rendering", () => {
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
      taskPacket: createTaskPacketFixture({
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      }),
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
      taskPacket: createTaskPacketFixture({
        sourceKind: "task-note",
        sourcePath: join(cwd, "tasks", "task.md"),
        originKind: "task-note",
        originPath: join(cwd, "notes", "seed.md"),
        artifactKind: "document",
        targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
      }),
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
      taskPacket: createTaskPacketFixture({
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      }),
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
      taskPacket: createTaskPacketFixture({
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      }),
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
      taskPacket: createTaskPacketFixture({
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: externalTargetArtifactPath,
      }),
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
      taskPacket: createTaskPacketFixture({
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      }),
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
