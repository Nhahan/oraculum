import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
} from "../src/core/paths.js";
import { verdictReviewSchema } from "../src/domain/chat-native.js";
import { buildVerdictReview, renderConsultationSummary } from "../src/services/consultations.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import {
  createInitializedProject,
  createManifest,
  registerConsultationsTempRootCleanup,
  toExpectedDisplayPath,
  writeManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation verdict review artifact availability: comparison", () => {
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
});
