import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getConsultationPlanReadinessPath } from "../src/core/paths.js";
import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { createTempProject, writePlanReadiness } from "./helpers/consultation-plan-execution.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

async function writeMinimalConsultationPlan(options: {
  cwd: string;
  runId: string;
  openQuestions?: string[];
  readyForConsult?: boolean;
}): Promise<string> {
  const taskPath = join(options.cwd, "tasks", `${options.runId}.md`);
  const reportsDir = join(options.cwd, ".oraculum", "runs", options.runId, "reports");
  const planPath = join(reportsDir, "consultation-plan.json");

  await mkdir(join(options.cwd, "tasks"), { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
  await writeFile(
    planPath,
    `${JSON.stringify(
      consultationPlanArtifactSchema.parse({
        runId: options.runId,
        createdAt: "2026-04-15T00:00:00.000Z",
        readyForConsult: options.readyForConsult ?? true,
        recommendedNextAction: `Execute the planned consultation: \`orc consult .oraculum/runs/${options.runId}/reports/consultation-plan.json\`.`,
        intendedResult: "recommended survivor",
        decisionDrivers: [],
        openQuestions: options.openQuestions ?? [],
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
        repoBasis: {
          projectRoot: options.cwd,
          signalFingerprint: "sha256:minimal-plan",
          availableOracleIds: [],
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
        workstreams: [],
        stagePlan: [],
        scorecardDefinition: {
          dimensions: [],
          abstentionTriggers: [],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: [],
          preferAbstainOverRetry: [],
        },
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  return planPath;
}

describe("consultation plan execution presets", () => {
  it("rejects persisted plans that are missing plan-readiness.json", async () => {
    const cwd = await createTempProject();
    await initializeProject({ cwd, force: false });
    const planPath = await writeMinimalConsultationPlan({ cwd, runId: "run_missing_readiness" });

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/missing plan-readiness\.json/);
  });

  it("rejects persisted plans with invalid plan-readiness.json", async () => {
    const cwd = await createTempProject();
    const runId = "run_invalid_readiness";
    await initializeProject({ cwd, force: false });
    const planPath = await writeMinimalConsultationPlan({ cwd, runId });
    await writeFile(getConsultationPlanReadinessPath(cwd, runId), "{ not json", "utf8");

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/invalid plan-readiness\.json/);
  });

  it("rejects blocked plan-readiness artifacts before candidate planning", async () => {
    const cwd = await createTempProject();
    const runId = "run_blocked_readiness";
    await initializeProject({ cwd, force: false });
    const planPath = await writeMinimalConsultationPlan({ cwd, runId });
    await writePlanReadiness(cwd, runId, {
      status: "blocked",
      readyForConsult: true,
      blockers: ["operator answer required"],
      nextAction: 'Start a new `orc plan "<task>"` with the clarified task contract.',
    });

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/operator answer required/);
  });

  it("rejects stale plan-readiness basis before candidate planning", async () => {
    const cwd = await createTempProject();
    const runId = "run_stale_readiness";
    await initializeProject({ cwd, force: false });
    const planPath = await writeMinimalConsultationPlan({ cwd, runId });
    await writePlanReadiness(cwd, runId, {
      status: "blocked",
      readyForConsult: false,
      staleBasis: true,
      blockers: ["plan basis is stale"],
      nextAction: "Refresh the consultation plan before running consult.",
    });

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/plan basis is stale/);
  });

  it("asks for clarification when persisted plans still have open questions", async () => {
    const cwd = await createTempProject();
    const runId = "run_not_ready";
    await initializeProject({ cwd, force: false });
    const planPath = await writeMinimalConsultationPlan({
      cwd,
      runId,
      openQuestions: ["Which acceptance checks should this plan bind?"],
      readyForConsult: false,
    });
    await writePlanReadiness(cwd, runId, {
      status: "clear",
      readyForConsult: true,
    });

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(
      /needs clarification before consult: the plan still has unanswered clarification/,
    );
  });

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
          repoBasis: {
            projectRoot: cwd,
            signalFingerprint: "sha256:run-stale",
            availableOracleIds: ["missing-oracle"],
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
          workstreams: [],
          stagePlan: [],
          scorecardDefinition: {
            dimensions: [],
            abstentionTriggers: [],
          },
          repairPolicy: {
            maxAttemptsPerStage: 0,
            immediateElimination: [],
            repairable: [],
            preferAbstainOverRetry: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_stale");

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/missing planned oracles: missing-oracle/);
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
          repoBasis: {
            projectRoot: cwd,
            signalFingerprint: "sha256:run-missing-plan-artifact",
            availableOracleIds: [],
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
          workstreams: [],
          stagePlan: [],
          scorecardDefinition: {
            dimensions: [],
            abstentionTriggers: [],
          },
          repairPolicy: {
            maxAttemptsPerStage: 0,
            immediateElimination: [],
            repairable: [],
            preferAbstainOverRetry: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_missing_plan_artifact");

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
