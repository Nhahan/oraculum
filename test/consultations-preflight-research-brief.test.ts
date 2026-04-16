import { describe, expect, it } from "vitest";
import { getResearchBriefPath } from "../src/core/paths.js";
import { buildSavedConsultationStatus } from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import { createInitializedProject, createManifest } from "./helpers/consultations.js";
import { registerConsultationsPreflightTempRootCleanup } from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight and replay", () => {
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
});
