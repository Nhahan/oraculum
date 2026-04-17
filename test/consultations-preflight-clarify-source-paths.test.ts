import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getClarifyFollowUpPath, getResearchBriefPath } from "../src/core/paths.js";
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

describe("consultation preflight clarify source paths", () => {
  it("matches repeated clarify pressure across origin-backed relative and absolute task source paths", async () => {
    const cwd = await createInitializedProject();
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteOriginPath = join(cwd, normalizedTaskSourcePath);
    await writeBlockedPreflightHistory(cwd, [
      createBlockedPreflightManifest("run_clarify_mixed_source_1", {
        preflightDecision: "needs-clarification",
        preflightQuestion: "Who is the intended operator audience?",
        preflightSummary: "The operator memo audience is still unclear.",
        sourcePath: normalizedTaskSourcePath,
      }),
      createBlockedPreflightManifest("run_clarify_mixed_source_2", {
        originKind: "task-note",
        originPath: absoluteOriginPath,
        preflightDecision: "external-research-required",
        preflightQuestion: "Which operator responsibilities are in scope?",
        preflightSummary: "Official operator guidance is still required.",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_mixed_source_2"),
      }),
    ]);

    const taskPacket = await writePreflightTaskPacket({
      contents: "# Task\nPrepare the operator memo.\n",
      cwd,
      id: "task",
      intent: "Prepare the operator memo.",
      runId: "run_clarify_mixed_source_current",
      sourcePath: absoluteOriginPath,
      title: "Task",
    });
    const adapter = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Who is the intended operator audience?",
      keyQuestion: "Which operator audience and operational scope should the memo target?",
      missingJudgingBasis: "The review basis does not define how to judge the finished memo.",
      missingResultContract: "The memo still lacks a concrete audience and deliverable contract.",
      preflightSummary: "Need a clearer memo audience before execution.",
      summary: "Repeated blockers show the operator memo scope is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter: adapter.adapter,
      cwd,
      runId: "run_clarify_mixed_source_current",
      taskPacket,
    });

    expect(adapter.getClarifyCalls()).toBe(1);
    expect(adapter.getPressureContext()).toEqual(
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
    await writeBlockedPreflightHistory(cwd, [
      createBlockedPreflightManifest("run_clarify_external_source_1", {
        preflightDecision: "needs-clarification",
        preflightQuestion: "Who is the intended audience for the external memo?",
        preflightSummary: "The external memo audience is still unclear.",
        sourcePath: externalTaskSourcePath,
      }),
      createBlockedPreflightManifest("run_clarify_external_source_2", {
        originKind: "task-note",
        originPath: externalTaskSourcePath,
        preflightDecision: "external-research-required",
        preflightQuestion: "Which external audience and responsibilities are in scope?",
        preflightSummary: "Official external guidance is still required.",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_source_2"),
      }),
    ]);

    const taskPacket = await writePreflightTaskPacket({
      contents: "# Task\nPrepare the external operator memo.\n",
      cwd,
      id: "task",
      intent: "Prepare the external operator memo.",
      runId: "run_clarify_external_source_current",
      sourcePath: externalTaskSourcePath,
      title: "Task",
    });
    const adapter = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Who is the intended audience for the external memo?",
      keyQuestion: "Which external audience and operational scope should the memo target?",
      missingJudgingBasis:
        "The review basis does not define how to judge the finished external memo.",
      missingResultContract:
        "The memo still lacks a concrete external audience and deliverable contract.",
      preflightSummary: "Need a clearer audience before execution.",
      summary: "Repeated blockers show the external memo scope is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter: adapter.adapter,
      cwd,
      runId: "run_clarify_external_source_current",
      taskPacket,
    });

    expect(adapter.getClarifyCalls()).toBe(1);
    expect(adapter.getPressureContext()).toEqual(
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
    await writeBlockedPreflightHistory(cwd, [
      createBlockedPreflightManifest("run_clarify_external_mixed_source_1", {
        preflightDecision: "needs-clarification",
        preflightQuestion: "Who is the intended audience for the external memo?",
        preflightSummary: "The external memo audience is still unclear.",
        sourcePath: externalRelativeTaskSourcePath,
      }),
      createBlockedPreflightManifest("run_clarify_external_mixed_source_2", {
        originKind: "task-note",
        originPath: externalAbsoluteTaskSourcePath,
        preflightDecision: "external-research-required",
        preflightQuestion: "Which external audience and responsibilities are in scope?",
        preflightSummary: "Official external guidance is still required.",
        sourceKind: "research-brief",
        sourcePath: getResearchBriefPath(cwd, "run_clarify_external_mixed_source_2"),
      }),
    ]);

    const taskPacket = await writePreflightTaskPacket({
      contents: "# Task\nPrepare the external operator memo.\n",
      cwd,
      id: "task",
      intent: "Prepare the external operator memo.",
      runId: "run_clarify_external_mixed_source_current",
      sourcePath: externalAbsoluteTaskSourcePath,
      title: "Task",
    });
    const adapter = createCapturingClarifyPreflightAdapter({
      clarificationQuestion: "Who is the intended audience for the external memo?",
      keyQuestion: "Which external audience and operational scope should the memo target?",
      missingJudgingBasis:
        "The review basis does not define how to judge the finished external memo.",
      missingResultContract:
        "The memo still lacks a concrete external audience and deliverable contract.",
      preflightSummary: "Need a clearer audience before execution.",
      summary: "Repeated blockers show the external memo scope is underspecified.",
    });

    await runConsultationPreflightScenario({
      adapter: adapter.adapter,
      cwd,
      runId: "run_clarify_external_mixed_source_current",
      taskPacket,
    });

    expect(adapter.getClarifyCalls()).toBe(1);
    expect(adapter.getPressureContext()).toEqual(
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
});
