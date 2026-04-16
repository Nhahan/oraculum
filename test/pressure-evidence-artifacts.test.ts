import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getClarifyFollowUpPath,
  getFailureAnalysisPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getResearchBriefPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { collectPressureEvidence } from "../src/services/pressure-evidence.js";
import {
  createExternalResearchPressureManifest,
  createFinalistsPressureManifest,
  createInitializedProject,
  registerPressureEvidenceTempRootCleanup,
  writeManifest,
} from "./helpers/pressure-evidence.js";

registerPressureEvidenceTempRootCleanup();

describe("pressure evidence collection: artifact handling", () => {
  it("ignores invalid persisted artifacts when computing evidence coverage", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createExternalResearchPressureManifest("run_invalid_clarify_artifacts", {
        taskPacketOverrides: {
          title: "Refresh rollout FAQ",
          sourcePath: "/tmp/rollout-faq.md",
          targetArtifactPath: "docs/ROLLOUT_FAQ.md",
        },
        preflightOverrides: {
          summary: "Official rollout answers are still required.",
          researchQuestion: "Which rollout answers are current in the official docs?",
        },
      }),
    );
    await writeFile(
      getPreflightReadinessPath(cwd, "run_invalid_clarify_artifacts"),
      "{}\n",
      "utf8",
    );
    await writeFile(getClarifyFollowUpPath(cwd, "run_invalid_clarify_artifacts"), "{}\n", "utf8");
    await writeFile(getResearchBriefPath(cwd, "run_invalid_clarify_artifacts"), "{}\n", "utf8");

    await writeManifest(
      cwd,
      createFinalistsPressureManifest("run_invalid_finalist_artifacts", {
        createdAt: "2026-04-05T00:00:00.000Z",
        taskPacketOverrides: {
          title: "Compare rollout finalists",
          sourcePath: "/tmp/rollout-finalists.md",
          targetArtifactPath: "docs/ROLLOUT_FAQ.md",
        },
      }),
    );
    await writeFile(getWinnerSelectionPath(cwd, "run_invalid_finalist_artifacts"), "{}\n", "utf8");
    await writeFile(
      getFinalistComparisonMarkdownPath(cwd, "run_invalid_finalist_artifacts"),
      " \n",
      "utf8",
    );
    await writeFile(getFailureAnalysisPath(cwd, "run_invalid_finalist_artifacts"), "{}\n", "utf8");

    const report = await collectPressureEvidence(cwd);

    expect(report.artifactCoverage).toEqual(
      expect.objectContaining({
        consultationsWithClarifyFollowUp: 0,
        consultationsWithResearchBrief: 0,
        consultationsWithWinnerSelection: 0,
        consultationsWithFailureAnalysis: 0,
      }),
    );
    expect(report.clarifyPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 1,
        casesWithClarifyFollowUp: 0,
        casesWithResearchBrief: 0,
      }),
    );
    expect(report.clarifyPressure.coverageBlindSpots).toContain(
      "External-research blockers have no persisted research-brief artifacts yet.",
    );
    expect(report.clarifyPressure.coverageGapRuns).toEqual([
      expect.objectContaining({
        runId: "run_invalid_clarify_artifacts",
        missingArtifactKinds: ["preflight-readiness", "research-brief"],
      }),
    ]);
    expect(report.clarifyPressure.cases).toEqual([
      expect.objectContaining({
        runId: "run_invalid_clarify_artifacts",
        artifactPaths: expect.not.objectContaining({
          clarifyFollowUpPath: expect.any(String),
          researchBriefPath: expect.any(String),
        }),
      }),
    ]);
    expect(report.finalistSelectionPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 2,
        casesWithWinnerSelection: 0,
        casesWithFailureAnalysis: 0,
      }),
    );
    expect(report.finalistSelectionPressure.coverageBlindSpots).toContain(
      "Some finalist-selection pressure cases are missing winner-selection artifacts.",
    );
    expect(report.finalistSelectionPressure.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_invalid_finalist_artifacts",
          kind: "finalists-without-recommendation",
          artifactPaths: expect.not.objectContaining({
            winnerSelectionPath: expect.any(String),
            failureAnalysisPath: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
