import { describe, expect, it } from "vitest";

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
  it("matches repeated clarify pressure across relative and absolute in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_clarify_mixed_target_current";
    const relativeTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = `${cwd}/docs/PRD.md`;

    await writeBlockedPreflightHistory(cwd, [
      createTargetArtifactBlockedPreflightManifest(
        cwd,
        "run_clarify_mixed_target_1",
        relativeTargetArtifactPath,
        {
          preflightDecision: "needs-clarification",
          preflightQuestion: "Which sections must the PRD contain?",
          preflightSummary: "The PRD sections are unclear.",
        },
      ),
      createTargetArtifactBlockedPreflightManifest(
        cwd,
        "run_clarify_mixed_target_2",
        absoluteTargetArtifactPath,
        {
          preflightDecision: "external-research-required",
          preflightQuestion: "What should the PRD cover for this launch?",
          preflightSummary: "Official product docs are still required.",
        },
      ),
    ]);

    const taskPacket = await writeTargetArtifactTaskPacket({
      contents: "# Task\nPrepare the PRD.\n",
      cwd,
      id: "task",
      intent: "Prepare the product requirements document.",
      runId,
      targetArtifactPath: absoluteTargetArtifactPath,
      title: "Task",
    });

    const { adapter, getClarifyCalls } = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Which sections must docs/PRD.md contain?",
      keyQuestion: "Which sections and acceptance bullets must the PRD include?",
      missingJudgingBasis:
        "The review basis does not define how the completed PRD should be judged.",
      missingResultContract: "The expected section-level PRD result contract is still missing.",
      preflightSummary: "Need a clearer result contract before execution.",
      summary: "Repeated blockers show the PRD contract is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter,
      cwd,
      runId,
      taskPacket,
    });

    expect(getClarifyCalls()).toBe(1);
    const clarifyFollowUp = await readClarifyFollowUpArtifact(cwd, runId);
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(relativeTargetArtifactPath);
  });

  it("matches repeated clarify pressure across dotted and plain in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_clarify_dotted_target_current";
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const dottedTargetArtifactPath = `./${normalizedTargetArtifactPath}`;

    await writeBlockedPreflightHistory(cwd, [
      createTargetArtifactBlockedPreflightManifest(
        cwd,
        "run_clarify_dotted_target_1",
        normalizedTargetArtifactPath,
        {
          preflightDecision: "needs-clarification",
          preflightQuestion: "Which sections must the PRD contain?",
          preflightSummary: "The PRD sections are unclear.",
        },
      ),
      createTargetArtifactBlockedPreflightManifest(
        cwd,
        "run_clarify_dotted_target_2",
        dottedTargetArtifactPath,
        {
          preflightDecision: "external-research-required",
          preflightQuestion: "What should the PRD cover for this launch?",
          preflightSummary: "Official product docs are still required.",
        },
      ),
    ]);

    const taskPacket = await writeTargetArtifactTaskPacket({
      contents: "# Task\nPrepare the PRD.\n",
      cwd,
      id: "task",
      intent: "Prepare the product requirements document.",
      runId,
      targetArtifactPath: dottedTargetArtifactPath,
      title: "Task",
    });

    const { adapter, getClarifyCalls } = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Which sections must docs/PRD.md contain?",
      keyQuestion: "Which sections and acceptance bullets must the PRD include?",
      missingJudgingBasis:
        "The review basis does not define how the completed PRD should be judged.",
      missingResultContract: "The expected section-level PRD result contract is still missing.",
      preflightSummary: "Need a clearer result contract before execution.",
      summary: "Repeated blockers show the PRD contract is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter,
      cwd,
      runId,
      taskPacket,
    });

    expect(getClarifyCalls()).toBe(1);
    const clarifyFollowUp = await readClarifyFollowUpArtifact(cwd, runId);
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTargetArtifactPath);
  });
});
