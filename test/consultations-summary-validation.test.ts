import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { getProfileSelectionPath } from "../src/core/paths.js";
import { consultationProfileSelectionArtifactSchema } from "../src/domain/profile.js";
import { buildSavedConsultationStatus, type RunManifest } from "../src/domain/run.js";
import { renderConsultationSummary } from "../src/services/consultations.js";
import {
  createInitializedProject,
  createManifest,
  registerConsultationsTempRootCleanup,
  writeManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation summary validation rendering", () => {
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
        validationProfileId: "frontend",
        confidence: "medium",
        source: "fallback-detection",
        validationSummary: "Frontend signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: ["lint-fast", "typecheck-fast", "build-impact"],
        validationGaps: ["No e2e or visual deep check was detected."],
        validationSignals: ["frontend-framework", "build-script"],
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
        validationProfileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        validationSummary: "Library validation coverage is explicit.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast", "unit-impact", "full-suite-deep"],
        validationGaps: [],
        validationSignals: ["library"],
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Verification level: thorough");
    expect(status.verificationLevel).toBe("thorough");
  });

  it("keeps validation summary details aligned in saved status for profile-backed manifests", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        validationProfileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        validationSummary: "Package export evidence is strongest.",
        candidateCount: 2,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast"],
        validationGaps: [],
        validationSignals: ["package-export"],
      },
    });
    await writeManifest(cwd, manifest);

    const status = buildSavedConsultationStatus(manifest as RunManifest);

    expect(status.validationProfileId).toBe("library");
    expect(status.validationSummary).toBe("Package export evidence is strongest.");
    expect(status.validationSignals).toEqual(["package-export"]);
    expect(status.validationGaps).toEqual([]);
  });
});
