import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { getPreflightReadinessPath, getResearchBriefPath } from "../src/core/paths.js";
import {
  buildSavedConsultationStatus,
  consultationResearchBriefSchema,
} from "../src/domain/run.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import {
  createInitializedProject,
  createManifest,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./helpers/consultations.js";
import { registerConsultationsPreflightTempRootCleanup } from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight and replay", () => {
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
});
