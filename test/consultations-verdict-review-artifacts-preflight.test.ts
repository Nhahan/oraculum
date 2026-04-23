import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import {
  createClarificationManifest,
  createInitializedProject,
  createManifest,
  registerConsultationsTempRootCleanup,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation verdict review artifact availability: preflight", () => {
  it("treats invalid clarify follow-up artifacts as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_invalid_clarify_follow_up");
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
    const manifest = createClarificationManifest("run_invalid_preflight_readiness");
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

  it("treats stale preflight-readiness artifacts that omit runId as unavailable in verdict review", async () => {
    const cwd = await createInitializedProject();
    const manifest = createClarificationManifest("run_legacy_preflight_readiness");
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
            summary: "Stale preflight artifact should not be reused.",
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

  it("treats stale research brief and profile selection artifacts that omit runId as unavailable in verdict review", async () => {
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
          summary: "Stale research brief should not be replayed.",
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
});
