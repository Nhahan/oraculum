import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCandidateScorecardPath, getCandidateVerdictPath } from "../src/core/paths.js";
import { candidateScorecardSchema, consultationPlanArtifactSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  createTempProject,
  writeAdvancedConfig,
  writePlanReadiness,
} from "./helpers/consultation-plan-execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

describe("consultation plan execution presets", () => {
  it(
    "persists candidate scorecards for complex consultation plans",
    async () => {
      const cwd = await createTempProject();
      const taskPath = join(cwd, "tasks", "complex.md");
      const planPath = join(
        cwd,
        ".oraculum",
        "runs",
        "run_complex_scorecard",
        "reports",
        "consultation-plan.json",
      );

      await initializeProject({ cwd, force: false });
      await mkdir(join(cwd, "tasks"), { recursive: true });
      await mkdir(join(cwd, ".oraculum", "runs", "run_complex_scorecard", "reports"), {
        recursive: true,
      });
      await writeFile(taskPath, "# Complex contract\nRespect the staged contract.\n", "utf8");
      await writeAdvancedConfig(cwd, {
        repair: {
          enabled: false,
          maxAttemptsPerRound: 0,
        },
      });
      await writeFile(
        planPath,
        `${JSON.stringify(
          consultationPlanArtifactSchema.parse({
            runId: "run_complex_scorecard",
            createdAt: "2026-04-15T00:00:00.000Z",
            mode: "complex",
            readyForConsult: true,
            recommendedNextAction:
              "Execute the planned consultation: `orc consult .oraculum/runs/run_complex_scorecard/reports/consultation-plan.json`.",
            intendedResult: "recommended survivor",
            decisionDrivers: ["Use the staged workstream contract."],
            plannedJudgingCriteria: [],
            crownGates: [],
            openQuestions: [],
            task: {
              id: "complex_scorecard",
              title: "Complex scorecard",
              intent: "Respect the staged workstream contract.",
              nonGoals: [],
              acceptanceCriteria: ["Leave a reviewable patch."],
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
              summary: "Proceed with the complex staged contract.",
              researchPosture: "repo-only",
            },
            candidateCount: 1,
            plannedStrategies: [
              {
                id: "planned-complex",
                label: "Planned Complex",
              },
            ],
            oracleIds: [],
            roundOrder: [
              {
                id: "fast",
                label: "Fast",
              },
            ],
            workstreams: [
              {
                id: "session-contract",
                label: "Session Contract",
                goal: "Touch the planned session artifact.",
                targetArtifacts: ["candidate-change.txt"],
                requiredChangedPaths: ["candidate-change.txt"],
                protectedPaths: ["docs/KEEP.md"],
                oracleIds: [],
                dependencies: [],
                risks: ["Do not skip the required session file."],
                disqualifiers: ["Only sidecar docs change."],
              },
            ],
            stagePlan: [
              {
                id: "contract-fit",
                label: "Contract Fit",
                dependsOn: [],
                workstreamIds: ["session-contract"],
                roundIds: ["fast"],
                entryCriteria: ["plan is current"],
                exitCriteria: ["all workstreams have target coverage"],
              },
            ],
            scorecardDefinition: {
              dimensions: ["workstream-coverage", "artifact-coherence"],
              abstentionTriggers: ["missing required workstream coverage"],
            },
            repairPolicy: {
              maxAttemptsPerStage: 0,
              immediateElimination: ["protected-path-violation", "forbidden-collateral-path"],
              repairable: ["missing-target-coverage", "partial-workstream-coverage"],
              preferAbstainOverRetry: ["integration-contradiction"],
            },
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writePlanReadiness(cwd, "run_complex_scorecard");

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-complex-scorecard",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 satisfied the complex stage contract."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      });
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      const scorecard = candidateScorecardSchema.parse(
        JSON.parse(
          await readFile(getCandidateScorecardPath(cwd, planned.id, "cand-01"), "utf8"),
        ) as unknown,
      );
      expect(scorecard.mode).toBe("complex");
      expect(scorecard.stageResults).toEqual([
        expect.objectContaining({
          stageId: "contract-fit",
          status: "pass",
          workstreamCoverage: {
            "session-contract": "covered",
          },
        }),
      ]);
      await expect(
        stat(
          getCandidateVerdictPath(
            cwd,
            planned.id,
            "cand-01",
            "fast",
            "planned-stage-exit-criteria-contract-fit",
          ),
        ),
      ).resolves.toBeTruthy();
      await expect(
        stat(
          getCandidateVerdictPath(
            cwd,
            planned.id,
            "cand-01",
            "fast",
            "planned-required-changed-paths",
          ),
        ),
      ).rejects.toThrow();
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates when complex workstream coverage is missing even without top-level path guards",
    async () => {
      const cwd = await createTempProject();
      const taskPath = join(cwd, "tasks", "complex-miss.md");
      const planPath = join(
        cwd,
        ".oraculum",
        "runs",
        "run_complex_miss",
        "reports",
        "consultation-plan.json",
      );

      await initializeProject({ cwd, force: false });
      await mkdir(join(cwd, "tasks"), { recursive: true });
      await mkdir(join(cwd, ".oraculum", "runs", "run_complex_miss", "reports"), {
        recursive: true,
      });
      await writeFile(taskPath, "# Complex miss\nForce stage gating.\n", "utf8");
      await writeAdvancedConfig(cwd, {
        repair: {
          enabled: false,
          maxAttemptsPerRound: 0,
        },
      });
      await writeFile(
        planPath,
        `${JSON.stringify(
          consultationPlanArtifactSchema.parse({
            runId: "run_complex_miss",
            createdAt: "2026-04-15T00:00:00.000Z",
            mode: "complex",
            readyForConsult: true,
            recommendedNextAction:
              "Execute the planned consultation: `orc consult .oraculum/runs/run_complex_miss/reports/consultation-plan.json`.",
            intendedResult: "recommended survivor",
            decisionDrivers: ["Use workstream coverage to filter weak finalists."],
            plannedJudgingCriteria: [],
            crownGates: [],
            openQuestions: [],
            task: {
              id: "complex_miss",
              title: "Complex miss",
              intent: "Force stage gating.",
              nonGoals: [],
              acceptanceCriteria: ["Leave a reviewable patch."],
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
              summary: "Proceed with the complex staged contract.",
              researchPosture: "repo-only",
            },
            candidateCount: 1,
            plannedStrategies: [
              {
                id: "planned-complex",
                label: "Planned Complex",
              },
            ],
            oracleIds: [],
            roundOrder: [
              {
                id: "fast",
                label: "Fast",
              },
            ],
            workstreams: [
              {
                id: "coverage-contract",
                label: "Coverage Contract",
                goal: "Touch the expected staged artifact.",
                targetArtifacts: ["expected-change.txt"],
                requiredChangedPaths: ["expected-change.txt"],
                protectedPaths: [],
                oracleIds: [],
                dependencies: [],
                risks: ["Do not skip the expected staged artifact."],
                disqualifiers: ["Only unrelated files change."],
              },
            ],
            stagePlan: [
              {
                id: "contract-fit",
                label: "Contract Fit",
                dependsOn: [],
                workstreamIds: ["coverage-contract"],
                roundIds: ["fast"],
                entryCriteria: ["plan is current"],
                exitCriteria: ["all workstreams have target coverage"],
              },
            ],
            scorecardDefinition: {
              dimensions: ["workstream-coverage"],
              abstentionTriggers: ["missing required workstream coverage"],
            },
            repairPolicy: {
              maxAttemptsPerStage: 0,
              immediateElimination: ["protected-path-violation", "forbidden-collateral-path"],
              repairable: ["missing-target-coverage", "partial-workstream-coverage"],
              preferAbstainOverRetry: ["integration-contradiction"],
            },
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );
      await writePlanReadiness(cwd, "run_complex_miss");

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-complex-miss",
        `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      });
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();
      expect(executed.manifest.outcome?.type).toBe("no-survivors");
      const scorecard = candidateScorecardSchema.parse(
        JSON.parse(
          await readFile(getCandidateScorecardPath(cwd, planned.id, "cand-01"), "utf8"),
        ) as unknown,
      );
      expect(scorecard.stageResults).toEqual([
        expect.objectContaining({
          stageId: "contract-fit",
          status: "repairable",
          workstreamCoverage: {
            "coverage-contract": "missing",
          },
        }),
      ]);
      expect(scorecard.violations.join(" ")).toContain("coverage-contract");
      await expect(
        stat(
          getCandidateVerdictPath(
            cwd,
            planned.id,
            "cand-01",
            "fast",
            "planned-required-changed-paths",
          ),
        ),
      ).rejects.toThrow();
      const stageExitVerdict = JSON.parse(
        await readFile(
          getCandidateVerdictPath(
            cwd,
            planned.id,
            "cand-01",
            "fast",
            "planned-stage-exit-criteria-contract-fit",
          ),
          "utf8",
        ),
      ) as {
        status: string;
        summary: string;
      };
      expect(stageExitVerdict.status).toBe("repairable");
      expect(stageExitVerdict.summary).toContain("coverage-contract");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it("rejects complex consultation plans that reference unknown stage workstreams", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "complex-invalid.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_complex_invalid",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_complex_invalid", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Complex invalid\nReject bad graph.\n", "utf8");
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_complex_invalid",
          createdAt: "2026-04-15T00:00:00.000Z",
          mode: "complex",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_complex_invalid/reports/consultation-plan.json`.",
          intendedResult: "recommended survivor",
          decisionDrivers: [],
          plannedJudgingCriteria: [],
          crownGates: [],
          openQuestions: [],
          task: {
            id: "complex_invalid",
            title: "Complex invalid",
            intent: "Reject bad graph.",
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
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-complex",
              label: "Planned Complex",
            },
          ],
          oracleIds: [],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
          workstreams: [
            {
              id: "known-workstream",
              label: "Known Workstream",
              goal: "Do something valid.",
              targetArtifacts: ["candidate-change.txt"],
              requiredChangedPaths: ["candidate-change.txt"],
              protectedPaths: [],
              oracleIds: [],
              dependencies: [],
              risks: [],
              disqualifiers: [],
            },
          ],
          stagePlan: [
            {
              id: "contract-fit",
              label: "Contract Fit",
              dependsOn: [],
              workstreamIds: ["missing-workstream"],
              roundIds: ["fast"],
              entryCriteria: [],
              exitCriteria: [],
            },
          ],
          scorecardDefinition: {
            dimensions: ["workstream-coverage"],
            abstentionTriggers: [],
          },
          repairPolicy: {
            maxAttemptsPerStage: 0,
            immediateElimination: [],
            repairable: ["missing-target-coverage"],
            preferAbstainOverRetry: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_complex_invalid");

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/references unknown workstream "missing-workstream"/);
  });

  it("rejects complex consultation plans with stage dependency cycles", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "complex-cycle.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_complex_cycle",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_complex_cycle", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Complex cycle\nReject cyclic graph.\n", "utf8");
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_complex_cycle",
          createdAt: "2026-04-15T00:00:00.000Z",
          mode: "complex",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_complex_cycle/reports/consultation-plan.json`.",
          intendedResult: "recommended survivor",
          decisionDrivers: [],
          plannedJudgingCriteria: [],
          crownGates: [],
          openQuestions: [],
          task: {
            id: "complex_cycle",
            title: "Complex cycle",
            intent: "Reject cyclic graph.",
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
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-complex",
              label: "Planned Complex",
            },
          ],
          oracleIds: [],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
          workstreams: [
            {
              id: "known-workstream",
              label: "Known Workstream",
              goal: "Do something valid.",
              targetArtifacts: ["candidate-change.txt"],
              requiredChangedPaths: ["candidate-change.txt"],
              protectedPaths: [],
              oracleIds: [],
              dependencies: [],
              risks: [],
              disqualifiers: [],
            },
          ],
          stagePlan: [
            {
              id: "stage-a",
              label: "Stage A",
              dependsOn: ["stage-b"],
              workstreamIds: ["known-workstream"],
              roundIds: ["fast"],
              entryCriteria: [],
              exitCriteria: [],
            },
            {
              id: "stage-b",
              label: "Stage B",
              dependsOn: ["stage-a"],
              workstreamIds: ["known-workstream"],
              roundIds: ["fast"],
              entryCriteria: [],
              exitCriteria: [],
            },
          ],
          scorecardDefinition: {
            dimensions: ["workstream-coverage"],
            abstentionTriggers: [],
          },
          repairPolicy: {
            maxAttemptsPerStage: 0,
            immediateElimination: [],
            repairable: ["missing-target-coverage"],
            preferAbstainOverRetry: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_complex_cycle");

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/contains a stage dependency cycle/);
  });
});
