import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { getPreflightReadinessPath } from "../src/core/paths.js";
import { collectPressureEvidence } from "../src/services/pressure-evidence.js";
import { createInitializedProject } from "./helpers/consultations.js";
import {
  createCapturingClarifyPreflightAdapter,
  createTargetArtifactBlockedPreflightManifest,
  readClarifyFollowUpArtifact,
  registerConsultationsPreflightTempRootCleanup,
  runConsultationPreflightScenario,
  writeBlockedPreflightHistory,
  writeTargetArtifactTaskPacket,
} from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight and replay", () => {
  it("writes a clarify follow-up artifact only after repeated same-scope blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_clarify_current";
    const targetArtifactPath = "docs/PRD.md";

    await writeBlockedPreflightHistory(cwd, [
      createTargetArtifactBlockedPreflightManifest(cwd, "run_clarify_prior_1", targetArtifactPath, {
        preflightDecision: "needs-clarification",
        preflightQuestion: "Which sections must the PRD contain?",
        preflightSummary: "The PRD sections are unclear.",
      }),
      createTargetArtifactBlockedPreflightManifest(cwd, "run_clarify_prior_2", targetArtifactPath, {
        preflightDecision: "external-research-required",
        preflightQuestion: "What should the PRD cover for this launch?",
        preflightSummary: "Official product docs are still required.",
      }),
    ]);

    const taskPacket = await writeTargetArtifactTaskPacket({
      contents: "# Task\nPrepare the PRD.\n",
      cwd,
      id: "task",
      intent: "Prepare the product requirements document.",
      runId,
      targetArtifactPath,
      title: "Task",
    });

    const evidence = await collectPressureEvidence(cwd);
    expect(evidence.clarifyPressure.promotionSignal.shouldPromote).toBe(true);
    expect(evidence.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath,
        occurrenceCount: 2,
      }),
    ]);

    const { adapter, getClarifyCalls, getPressureContext } = createCapturingClarifyPreflightAdapter(
      {
        clarificationQuestion: "Which sections must docs/PRD.md contain?",
        keyQuestion: "Which sections and acceptance bullets must the PRD include?",
        missingJudgingBasis:
          "The review basis does not define how the completed PRD should be judged.",
        missingResultContract: "The expected section-level PRD result contract is still missing.",
        preflightSummary: "Need a clearer result contract before execution.",
        summary: "Repeated blockers show the PRD contract is underspecified.",
      },
    );

    const result = await runConsultationPreflightScenario({
      adapter,
      cwd,
      runId,
      taskPacket,
    });

    expect(result.preflight.decision).toBe("needs-clarification");
    expect(getClarifyCalls()).toBe(1);
    expect(getPressureContext()).toEqual(
      expect.objectContaining({
        scopeKeyType: "target-artifact",
        scopeKey: targetArtifactPath,
        repeatedCaseCount: 2,
        repeatedKinds: expect.arrayContaining(["clarify-needed", "external-research-required"]),
        recurringReasons: expect.arrayContaining([
          "Which sections must the PRD contain?",
          "What should the PRD cover for this launch?",
        ]),
        priorQuestions: expect.arrayContaining([
          "Which sections must the PRD contain?",
          "What should the PRD cover for this launch?",
        ]),
      }),
    );

    const clarifyFollowUp = await readClarifyFollowUpArtifact(cwd, runId);
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(targetArtifactPath);
    expect(clarifyFollowUp.repeatedCaseCount).toBe(2);
    expect(clarifyFollowUp.repeatedKinds).toEqual(
      expect.arrayContaining(["clarify-needed", "external-research-required"]),
    );
    expect(clarifyFollowUp.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );

    const readiness = JSON.parse(await readFile(getPreflightReadinessPath(cwd, runId), "utf8")) as {
      clarifyFollowUp?: { keyQuestion?: string };
    };
    expect(readiness.clarifyFollowUp?.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );
  });
});
