import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonMarkdownPath,
  getProfileSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { consultationProfileSelectionArtifactSchema } from "../src/domain/profile.js";
import type { ConsultationArtifacts } from "../src/services/consultations/summary/types.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import {
  createConsultationCandidate,
  createInitializedProject,
  createManifest,
  createTaskPacketFixture,
  registerConsultationsTempRootCleanup,
  writeExportPlanArtifact,
  writeFailureAnalysis,
  writeManifest,
  writePreflightReadinessArtifact,
  writeProfileSelectionArtifact,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation summary artifact rendering", () => {
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
  });

  it("uses caller-provided artifact state when rendering summaries", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed");
    const resolvedArtifacts: ConsultationArtifacts = {
      consultationRoot: join(cwd, ".oraculum", "runs", manifest.id),
      comparisonReportAvailable: false,
      manualReviewRequired: false,
      crowningRecordAvailable: false,
      hasExportedCandidate: false,
      artifactDiagnostics: [
        {
          kind: "profile-selection",
          path: join(cwd, ".oraculum", "runs", manifest.id, "reports", "profile-selection.json"),
          status: "invalid",
          message: "Injected diagnostic from a preloaded artifact snapshot.",
        },
      ],
    };

    const summary = await renderConsultationSummary(manifest, cwd, { resolvedArtifacts });

    expect(summary).toContain("Artifact diagnostics:");
    expect(summary).toContain("Injected diagnostic from a preloaded artifact snapshot.");
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
    await writeFailureAnalysis(cwd, manifest.id, {
      runId: manifest.id,
      generatedAt: "2026-04-04T00:00:00.000Z",
      trigger: "no-survivors",
      summary:
        "No finalists survived the oracle rounds; investigate failing oracle evidence before retrying.",
      recommendedAction: "investigate-root-cause-before-rerun",
      validationGaps: [],
      candidates: [],
    });

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      "- failure analysis: .oraculum/runs/run_failure_analysis/reports/failure-analysis.json",
    );
    expect(summary).toContain(
      "- investigate the persisted failure analysis: .oraculum/runs/run_failure_analysis/reports/failure-analysis.json.",
    );
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
    expect(summary).toContain("- answer the preflight clarification question.");
    expect(summary).toContain(
      '- rerun `orc consult "<task plus the answer>"` once the missing result contract and judging basis are explicit.',
    );
  });

  it("does not report a promotion record when only a stale export plan file exists", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        createConsultationCandidate("cand-01", "promoted", {
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
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
        createConsultationCandidate("cand-01", "eliminated", {
          workspaceDir: join(cwd, "workspace", "cand-01"),
          taskPacketPath: join(cwd, "task-packet.json"),
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      `Target artifact: ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
    expect(summary).not.toContain("../external/SESSION_PLAN.md");
  });
});
