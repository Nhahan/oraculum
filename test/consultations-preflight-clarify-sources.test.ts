import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentAdapter } from "../src/adapters/types.js";
import { getClarifyFollowUpPath, getResearchBriefPath } from "../src/core/paths.js";
import {
  consultationClarifyFollowUpSchema,
  consultationResearchBriefSchema,
} from "../src/domain/run.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";
import { recommendConsultationPreflight } from "../src/services/consultation-preflight.js";
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
  it("matches repeated clarify pressure across origin-backed relative and absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteOriginPath = join(cwd, normalizedTaskSourcePath);
    const priorOne = createManifest("completed", {
      id: "run_clarify_mixed_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: normalizedTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The operator memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended operator audience?",
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
      id: "run_clarify_mixed_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_mixed_source_2"),
        originKind: "task-note",
        originPath: absoluteOriginPath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official operator guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which operator responsibilities are in scope?",
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
      intent: "Prepare the operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: absoluteOriginPath,
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the operator memo.\n", "utf8");

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
          summary: "Need a clearer memo audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer memo audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended operator audience?",
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
          summary: "Clarify the memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the operator memo scope is underspecified.",
            keyQuestion: "Which operator audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete audience and deliverable contract.",
            missingJudgingBasis: "The review basis does not define how to judge the finished memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_mixed_source_current", "reports"),
      runId: "run_clarify_mixed_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: normalizedTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_mixed_source_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(normalizedTaskSourcePath);
  });

  it("matches repeated clarify pressure across external absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const externalTaskSourcePath = join(tmpdir(), "oraculum-external-task-note.md");
    const priorOne = createManifest("completed", {
      id: "run_clarify_external_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: externalTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The external memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended audience for the external memo?",
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
      id: "run_clarify_external_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_source_2"),
        originKind: "task-note",
        originPath: externalTaskSourcePath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official external guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which external audience and responsibilities are in scope?",
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
      intent: "Prepare the external operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: externalTaskSourcePath,
      },
    });
    await writeFile(
      taskPacket.source.path,
      "# Task\nPrepare the external operator memo.\n",
      "utf8",
    );

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
          summary: "Need a clearer audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended audience for the external memo?",
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
          summary: "Clarify the external memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the external memo scope is underspecified.",
            keyQuestion: "Which external audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete external audience and deliverable contract.",
            missingJudgingBasis:
              "The review basis does not define how to judge the finished external memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_external_source_current", "reports"),
      runId: "run_clarify_external_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: externalTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(getClarifyFollowUpPath(cwd, "run_clarify_external_source_current"), "utf8"),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(externalTaskSourcePath);
  });

  it("matches repeated clarify pressure across external relative and absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const externalRelativeTaskSourcePath = "../oraculum-external-task-note.md";
    const externalAbsoluteTaskSourcePath = join(cwd, externalRelativeTaskSourcePath);
    const priorOne = createManifest("completed", {
      id: "run_clarify_external_mixed_source_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: externalRelativeTaskSourcePath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The external memo audience is still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Who is the intended audience for the external memo?",
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
      id: "run_clarify_external_mixed_source_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_mixed_source_2"),
        originKind: "task-note",
        originPath: externalAbsoluteTaskSourcePath,
      },
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official external guidance is still required.",
        researchPosture: "external-research-required",
        researchQuestion: "Which external audience and responsibilities are in scope?",
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
      intent: "Prepare the external operator memo.",
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: externalAbsoluteTaskSourcePath,
      },
    });
    await writeFile(
      taskPacket.source.path,
      "# Task\nPrepare the external operator memo.\n",
      "utf8",
    );

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
          summary: "Need a clearer audience before execution.",
          recommendation: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "Need a clearer audience before execution.",
            researchPosture: "repo-only",
            clarificationQuestion: "Who is the intended audience for the external memo?",
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
          summary: "Clarify the external memo audience before retrying.",
          recommendation: {
            summary: "Repeated blockers show the external memo scope is underspecified.",
            keyQuestion: "Which external audience and operational scope should the memo target?",
            missingResultContract:
              "The memo still lacks a concrete external audience and deliverable contract.",
            missingJudgingBasis:
              "The review basis does not define how to judge the finished external memo.",
          },
          artifacts: [],
        };
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(
        cwd,
        ".oraculum",
        "runs",
        "run_clarify_external_mixed_source_current",
        "reports",
      ),
      runId: "run_clarify_external_mixed_source_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
      expect.objectContaining({
        scopeKeyType: "task-source",
        scopeKey: externalAbsoluteTaskSourcePath,
        repeatedCaseCount: 2,
      }),
    );
    const clarifyFollowUp = consultationClarifyFollowUpSchema.parse(
      JSON.parse(
        await readFile(
          getClarifyFollowUpPath(cwd, "run_clarify_external_mixed_source_current"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(clarifyFollowUp.scopeKeyType).toBe("task-source");
    expect(clarifyFollowUp.scopeKey).toBe(externalAbsoluteTaskSourcePath);
  });

  it("prefers repeated target-artifact pressure when both target and source scopes repeat", async () => {
    const cwd = await createInitializedProject();
    const normalizedTargetArtifactPath = "docs/PRD.md";
    const absoluteTargetArtifactPath = join(cwd, normalizedTargetArtifactPath);
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteTaskSourcePath = join(cwd, normalizedTaskSourcePath);

    const priorOne = createManifest("completed", {
      id: "run_clarify_both_axes_1",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: normalizedTaskSourcePath,
        artifactKind: "document",
        targetArtifactPath: normalizedTargetArtifactPath,
      },
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The PRD contract is still unclear.",
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
      id: "run_clarify_both_axes_2",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_both_axes_2"),
        originKind: "task-note",
        originPath: absoluteTaskSourcePath,
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
        path: absoluteTaskSourcePath,
      },
    });
    await writeFile(taskPacket.source.path, "# Task\nPrepare the PRD.\n", "utf8");

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

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_both_axes_current", "reports"),
      runId: "run_clarify_both_axes_current",
      taskPacket,
    });

    expect(clarifyCalls).toBe(1);
    expect(capturedPressureContext).toEqual(
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
      targetArtifactPath: "docs/PRD.md",
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
        throw new Error("should not run");
      },
    };

    await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_clarify_first", "reports"),
      runId: "run_clarify_first",
      taskPacket,
    });

    expect(clarifyCalls).toBe(0);
    await expect(
      readFile(getClarifyFollowUpPath(cwd, "run_clarify_first"), "utf8"),
    ).rejects.toThrow();
  });

  it("falls back to needs-clarification for vague low-contract tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = materializedTaskPacketSchema.parse({
      id: "ambiguous-release-guidance",
      title: "ambiguous release guidance",
      intent: [
        "Improve the release guidance so it is better and more complete.",
        "",
        "Notes:",
        "- Keep the change small.",
        "- Use the right artifact if one should change.",
        "- Make the result obviously better for operators.",
      ].join("\n"),
      nonGoals: [],
      acceptanceCriteria: [],
      risks: [],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: join(cwd, "dogfood-tasks", "ambiguous-release-guidance.md"),
      },
    });
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    await writeFile(taskPacket.source.path, `${taskPacket.intent}\n`, "utf8");

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
          status: "timed-out",
          startedAt: "2026-04-15T00:00:00.000Z",
          completedAt: "2026-04-15T00:00:45.000Z",
          exitCode: 0,
          summary: "Timed out before returning structured output.",
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        throw new Error("not used");
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_ambiguous_timeout", "reports"),
      runId: "run_ambiguous_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "needs-clarification",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. The task still lacks a concrete target artifact or result contract for safe execution.",
      researchPosture: "repo-only",
      clarificationQuestion:
        "Which file or artifact should Oraculum update, and what concrete result should it produce?",
    });
  });

  it("falls back to external-research-required for official current-version doc tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    const taskPacket = materializedTaskPacketSchema.parse({
      id: "external-doc-alignment",
      title: "external doc alignment",
      intent: [
        "Document whether the current Oraculum docs match the latest official OpenAI guidance for structured tool output and prompt-based JSON schema generation.",
        "",
        "Target outcome:",
        "- If repo-only evidence is enough, proceed conservatively.",
        "- If repo-only evidence is insufficient, do not guess. Require bounded external research and preserve a reusable research artifact.",
      ].join("\n"),
      nonGoals: [],
      acceptanceCriteria: [],
      risks: ["Prefer explicit research over speculation."],
      oracleHints: [],
      strategyHints: [],
      contextFiles: [],
      source: {
        kind: "task-note",
        path: join(cwd, "dogfood-tasks", "external-doc-alignment.md"),
      },
    });
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    await writeFile(taskPacket.source.path, `${taskPacket.intent}\n`, "utf8");

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
          status: "timed-out",
          startedAt: "2026-04-15T00:00:00.000Z",
          completedAt: "2026-04-15T00:00:45.000Z",
          exitCode: 0,
          summary: "Timed out before returning structured output.",
          artifacts: [],
        };
      },
      async recommendClarifyFollowUp() {
        throw new Error("not used");
      },
    };

    const result = await recommendConsultationPreflight({
      adapter,
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: join(cwd, ".oraculum", "runs", "run_external_doc_timeout", "reports"),
      runId: "run_external_doc_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "external-research-required",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. Official current-version documentation is still required before safe execution.",
      researchPosture: "external-research-required",
      researchQuestion:
        "What do the official current-version docs say about the requested behavior or guidance?",
    });
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(
        await readFile(getResearchBriefPath(cwd, "run_external_doc_timeout"), "utf8"),
      ) as unknown,
    );
    expect(researchBrief.question).toBe(
      "What do the official current-version docs say about the requested behavior or guidance?",
    );
  });
});
