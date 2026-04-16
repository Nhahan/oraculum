import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import { getClarifyFollowUpPath, getPreflightReadinessPath } from "../src/core/paths.js";
import { consultationClarifyFollowUpSchema } from "../src/domain/run.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";
import { recommendConsultationPreflight } from "../src/services/consultation-preflight.js";
import { collectPressureEvidence } from "../src/services/pressure-evidence.js";
import { loadProjectConfigLayers } from "../src/services/project.js";
import {
  createInitializedProject,
  createManifest,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./helpers/consultations.js";
import { registerConsultationsPreflightTempRootCleanup } from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight and replay", () => {
  it("writes a clarify follow-up artifact only after repeated same-scope blocked preflight", async () => {
    const cwd = await createInitializedProject();
    const targetArtifactPath = "docs/PRD.md";
    const priorOne = createManifest("completed", {
      id: "run_clarify_prior_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
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
    const priorTwo = createManifest("completed", {
      id: "run_clarify_prior_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
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
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");
    const evidence = await collectPressureEvidence(cwd);
    expect(evidence.clarifyPressure.promotionSignal.shouldPromote).toBe(true);
    expect(evidence.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath,
        occurrenceCount: 2,
      }),
    ]);

    let clarifyCalls = 0;
    let capturedPressureContext:
      | Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"]
      | undefined;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp(request) {
        clarifyCalls += 1;
        capturedPressureContext = request.pressureContext;
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_current", "reports"),
      runId: "run_clarify_current",
      taskPacket,
    });

    expect(result.preflight.decision).toBe("needs-clarification");
    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
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
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(await readFile(getClarifyFollowUpPath(cwd, "run_clarify_current"), "utf8")),
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(targetArtifactPath);
    expect(clarifyFollowUp.repeatedCaseCount).toBe(2);
    expect(clarifyFollowUp.repeatedKinds).toEqual(
      expect.arrayContaining(["clarify-needed", "external-research-required"]),
    );
    expect(clarifyFollowUp.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );
    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, "run_clarify_current"), "utf8"),
    ) as {
      clarifyFollowUp?: { keyQuestion?: string };
    };
    expect(readiness.clarifyFollowUp?.keyQuestion).toBe(
      "Which sections and acceptance bullets must the PRD include?",
    );
  });

  it("matches repeated clarify pressure across relative and absolute in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const relativeTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = join(cwd, "docs", "PRD.md");
    const priorOne = createManifest("completed", {
      id: "run_clarify_mixed_target_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: relativeTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
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
    const priorTwo = createManifest("completed", {
      id: "run_clarify_mixed_target_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
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
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: absoluteTargetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        clarifyCalls += 1;
        return {
          runId: "run_clarify_mixed_target_current",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_mixed_target_current", "reports"),
      runId: "run_clarify_mixed_target_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_mixed_target_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(relativeTargetArtifactPath);
  });

  it("matches repeated clarify pressure across dotted and plain in-repo target paths", async () => {
    const cwd = await createInitializedProject();
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const dottedTargetArtifactPath = `./${normalizedTargetArtifactPath}`;
    const priorOne = createManifest("completed", {
      id: "run_clarify_dotted_target_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: normalizedTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections must the PRD contain?",
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
    const priorTwo = createManifest("completed", {
      id: "run_clarify_dotted_target_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: dottedTargetArtifactPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official product docs are still required.",
        researchPosture: "external-research-required",
        researchQuestion: "What should the PRD cover for this launch?",
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
    await writeManifest(cwd, priorOne);
    await writeManifest(cwd, priorTwo);
    await writePreflightReadinessArtifact(cwd, priorOne.id);
    await writePreflightReadinessArtifact(cwd, priorTwo.id);

    const taskPacket = materializedTaskPacketSchema.parse({
      id: "task",
      title: "Task",
      intent: "Prepare the product requirements document.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      artifactKind: "document",
      targetArtifactPath: dottedTargetArtifactPath,
      source: {
        kind: "task-note",
        path: join(cwd, "task.md"),
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

    let clarifyCalls = 0;
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate() {
        throw new Error("not used");
      },
      async recommendWinner() {
        throw new Error("not used");
      },
      async recommendProfile() {
        throw new Error("not used");
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Need a clearer result contract before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer result contract before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which sections must docs/PRD.md contain?",
          },
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        clarifyCalls += 1;
        return {
          runId: "run_clarify_dotted_target_current",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Clarify the artifact contract before retrying.",
          recommendation: {
            summary: "Repeated blockers show the PRD contract is underspecified.",
            keyQuestion: "Which sections and acceptance bullets must the PRD include?",
            missingResultContract:
              "The expected section-level PRD result contract is still missing.",
            missingJudgingBasis:
              "The review basis does not define how the completed PRD should be judged.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_dotted_target_current", "reports"),
      runId: "run_clarify_dotted_target_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_dotted_target_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("target-artifact");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTargetArtifactPath);
  });
});
