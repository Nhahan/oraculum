import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { createTempProject } from "./helpers/consultation-plan-execution.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

describe("consultation plan execution presets", () => {
  it("rejects stale consultation plans that reference missing repo-local oracles", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_stale",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_stale", "reports"), { recursive: true });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_stale",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_stale/reports/consultation-plan.json`.",
          intendedResult: "recommended survivor",
          decisionDrivers: [],
          openQuestions: [],
          task: {
            id: "session",
            title: "Preserve session",
            intent: "Keep login state stable.",
            nonGoals: [],
            acceptanceCriteria: [],
            risks: [],
            oracleHints: [],
            strategyHints: [],
            contextFiles: [taskPath],
            source: {
              kind: "task-note",
              path: taskPath,
            },
          },
          preflight: {
            decision: "proceed",
            confidence: "high",
            summary: "Proceed with the persisted contract.",
            researchPosture: "repo-only",
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-fast-pass",
              label: "Planned Fast Pass",
            },
          ],
          oracleIds: ["missing-oracle"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/references oracle "missing-oracle"/);
  });

  it("rejects execution when the persisted consultation plan artifact disappears", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_missing_plan_artifact",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_missing_plan_artifact", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_missing_plan_artifact",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_missing_plan_artifact/reports/consultation-plan.json`.",
          intendedResult: "recommended result for candidate-change.txt",
          decisionDrivers: ["Target artifact path: candidate-change.txt"],
          openQuestions: [],
          task: {
            id: "session",
            title: "Preserve session",
            intent: "Keep login state stable.",
            targetArtifactPath: "candidate-change.txt",
            nonGoals: [],
            acceptanceCriteria: [],
            risks: [],
            oracleHints: [],
            strategyHints: [],
            contextFiles: [taskPath],
            source: {
              kind: "task-note",
              path: taskPath,
            },
          },
          preflight: {
            decision: "proceed",
            confidence: "high",
            summary: "Proceed with the persisted contract.",
            researchPosture: "repo-only",
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-fast-pass",
              label: "Planned Fast Pass",
            },
          ],
          oracleIds: [],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const planned = await planRun({
      cwd,
      taskInput: planPath,
      agent: "codex",
    });
    await unlink(planPath);

    await expect(
      executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: process.execPath,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      }),
    ).rejects.toThrow(/missing or invalid consultation plan artifact/);
  });
});
