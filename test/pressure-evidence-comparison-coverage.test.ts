import { describe, expect, it } from "vitest";

import { collectPressureEvidence } from "../src/services/pressure-evidence.js";
import {
  createFinalistsPressureManifest,
  createInitializedProject,
  registerPressureEvidenceTempRootCleanup,
  writeAbstainingWinnerSelection,
  writeComparisonArtifacts,
  writeComparisonReportJson,
  writeComparisonReportMarkdown,
  writeManifest,
} from "./helpers/pressure-evidence.js";

registerPressureEvidenceTempRootCleanup();

describe("pressure evidence collection: comparison coverage", () => {
  it("does not count blank comparison markdown as finalist evidence coverage", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_blank_comparison_markdown", {
        taskPacketOverrides: {
          title: "Compare onboarding finalists",
          sourcePath: "/tmp/onboarding-finalists.md",
          targetArtifactPath: "docs/ONBOARDING.md",
        },
      }),
    );
    await writeComparisonReportMarkdown(cwd, "run_blank_comparison_markdown", " \n");
    await writeAbstainingWinnerSelection(cwd, "run_blank_comparison_markdown");

    const report = await collectPressureEvidence(cwd);

    expect(report.artifactCoverage.consultationsWithComparisonReport).toBe(0);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        casesWithComparisonReport: 0,
      }),
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).toContain(
      "Some finalist-selection pressure cases are missing comparison reports.",
    );
  });
  it("counts non-empty markdown-only comparison reports as finalist evidence coverage", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_markdown_only_comparison", {
        taskPacketOverrides: {
          title: "Compare onboarding finalists",
          sourcePath: "/tmp/onboarding-finalists.md",
          targetArtifactPath: "docs/ONBOARDING.md",
        },
      }),
    );
    await writeComparisonReportMarkdown(
      cwd,
      "run_markdown_only_comparison",
      "# Finalist Comparison\n\n- Run: run_markdown_only_comparison\n\nCandidate notes.\n",
    );
    await writeAbstainingWinnerSelection(cwd, "run_markdown_only_comparison");

    const report = await collectPressureEvidence(cwd);

    expect(report.artifactCoverage.consultationsWithComparisonReport).toBe(1);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        casesWithComparisonReport: 3,
      }),
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).not.toContain(
      "Some finalist-selection pressure cases are missing comparison reports.",
    );
  });
  it("counts valid json comparison reports even when markdown is blank", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_json_plus_blank_markdown", {
        taskPacketOverrides: {
          title: "Compare onboarding finalists",
          sourcePath: "/tmp/onboarding-finalists.md",
          targetArtifactPath: "docs/ONBOARDING.md",
        },
      }),
    );
    await writeComparisonArtifacts(cwd, "run_json_plus_blank_markdown");
    await writeComparisonReportMarkdown(cwd, "run_json_plus_blank_markdown", " \n");
    await writeAbstainingWinnerSelection(cwd, "run_json_plus_blank_markdown");

    const report = await collectPressureEvidence(cwd);

    expect(report.artifactCoverage.consultationsWithComparisonReport).toBe(1);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        casesWithComparisonReport: 3,
      }),
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).not.toContain(
      "Some finalist-selection pressure cases are missing comparison reports.",
    );
  });
  it("counts valid json-only comparison reports as finalist evidence coverage", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_json_only_comparison", {
        taskPacketOverrides: {
          title: "Compare rollout finalists",
          sourcePath: "/tmp/rollout-finalists.md",
          targetArtifactPath: "docs/ROLLOUT.md",
        },
      }),
    );
    await writeAbstainingWinnerSelection(cwd, "run_json_only_comparison");
    await writeComparisonReportJson(cwd, "run_json_only_comparison", {
      generatedAt: "2026-04-05T00:00:02.000Z",
      task: {
        id: "task",
        title: "Compare rollout finalists",
        sourceKind: "task-note",
        sourcePath: "/tmp/rollout-finalists.md",
      },
      finalistCount: 2,
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.artifactCoverage.consultationsWithComparisonReport).toBe(1);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 3,
        casesWithComparisonReport: 3,
      }),
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).not.toContain(
      "Some finalist-selection pressure cases are missing comparison reports.",
    );
  });
});
