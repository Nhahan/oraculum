import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getClarifyFollowUpPath } from "../src/core/paths.js";
import { consultationClarifyFollowUpSchema } from "../src/domain/run.js";
import { createInitializedProject } from "./helpers/consultations.js";
import {
  createBlockedPreflightManifest,
  createCapturingClarifyPreflightAdapter,
  registerConsultationsPreflightTempRootCleanup,
  runConsultationPreflightScenario,
  writeBlockedPreflightHistory,
  writePreflightTaskPacket,
} from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight clarify scope priority", () => {
  it("prefers repeated target-artifact pressure when both target and source scopes repeat", async () => {
    const cwd = await createInitializedProject();
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = join(cwd, normalizedTargetArtifactPath);
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteTaskSourcePath = join(cwd, normalizedTaskSourcePath);
    await writeBlockedPreflightHistory(cwd, [
      createBlockedPreflightManifest("run_clarify_both_axes_1", {
        artifactKind: "document",
        preflightDecision: "needs-clarification",
        preflightQuestion: "Which sections must the PRD contain?",
        preflightSummary: "The PRD contract is still unclear.",
        sourcePath: normalizedTaskSourcePath,
        targetArtifactPath: normalizedTargetArtifactPath,
      }),
      createBlockedPreflightManifest("run_clarify_both_axes_2", {
        artifactKind: "document",
        originKind: "task-note",
        originPath: absoluteTaskSourcePath,
        preflightDecision: "external-research-required",
        preflightQuestion: "What should the PRD cover for this launch?",
        preflightSummary: "Official product docs are still required.",
        sourceKind: "research-brief",
        sourcePath: join(
          cwd,
          ".oraculum",
          "runs",
          "run_clarify_both_axes_2",
          "reports",
          "research-brief.json",
        ),
        targetArtifactPath: absoluteTargetArtifactPath,
      }),
    ]);

    const taskPacket = await writePreflightTaskPacket({
      artifactKind: "document",
      contents: "# Task\nPrepare the PRD.\n",
      cwd,
      id: "task",
      intent: "Prepare the product requirements document.",
      runId: "run_clarify_both_axes_current",
      sourcePath: absoluteTaskSourcePath,
      targetArtifactPath: absoluteTargetArtifactPath,
      title: "Task",
    });
    const adapter = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Which sections must docs/PRD.md contain?",
      keyQuestion: "Which sections and acceptance bullets must the PRD include?",
      missingJudgingBasis:
        "The review basis does not define how the completed PRD should be judged.",
      missingResultContract: "The expected section-level PRD result contract is still missing.",
      preflightSummary: "Need a clearer result contract before execution.",
      summary: "Repeated blockers show the PRD contract is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter: adapter.adapter,
      cwd,
      runId: "run_clarify_both_axes_current",
      taskPacket,
    });

    expect(adapter.getClarifyCalls()).toBe(1);
    expect(adapter.getPressureContext()).toEqual(
      expect.objectContaining({
        scopeKeyType: "target-artifact",
        scopeKey: normalizedTargetArtifactPath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_both_axes_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTargetArtifactPath);
  });

  it("does not write a clarify follow-up artifact for a first-time blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = await writePreflightTaskPacket({
      artifactKind: "document",
      contents: "# Task\nPrepare the PRD.\n",
      cwd,
      id: "task",
      intent: "Prepare the product requirements document.",
      runId: "run_clarify_first",
      sourcePath: join(cwd, "task.md"),
      targetArtifactPath: "docs/PRD.md",
      title: "Task",
    });
    const adapter = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Which sections must docs/PRD.md contain?",
      keyQuestion: "Which sections and acceptance bullets must the PRD include?",
      missingJudgingBasis:
        "The review basis does not define how the completed PRD should be judged.",
      missingResultContract: "The expected section-level PRD result contract is still missing.",
      preflightSummary: "Need a clearer result contract before execution.",
      summary: "Repeated blockers show the PRD contract is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter: adapter.adapter,
      cwd,
      runId: "run_clarify_first",
      taskPacket,
    });

    expect(adapter.getClarifyCalls()).toBe(0);
    await expect(
      readFile(getClarifyFollowUpPath(cwd, "run_clarify_first"), "utf8"),
    ).rejects.toThrow();
  });
});
