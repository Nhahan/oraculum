import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { projectConfigSchema } from "../src/domain/config.js";
import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  createOracle,
  createTempProject,
  writeAdvancedConfig,
  writePlanReadiness,
} from "./helpers/consultation-plan-execution.js";

describe("consultation plan execution presets", () => {
  it("writes judging presets into generated consultation plan artifacts", async () => {
    const cwd = await createTempProject();
    const taskPacketPath = join(cwd, "tasks", "plan-task.json");

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await writeFile(
      taskPacketPath,
      `${JSON.stringify(
        {
          id: "plan_task",
          title: "Revise PRD",
          intent: "Strengthen the PRD without broad collateral changes.",
          artifactKind: "document",
          targetArtifactPath: "docs/PRD.md",
          nonGoals: ["Do not rewrite unrelated release docs."],
          acceptanceCriteria: ["docs/PRD.md stays internally consistent."],
          risks: [],
          oracleHints: [],
          strategyHints: [],
          contextFiles: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const planned = await planRun({
      cwd,
      taskInput: taskPacketPath,
      agent: "codex",
      writeConsultationPlanArtifacts: true,
    });
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      planned.id,
      "reports",
      "consultation-plan.json",
    );
    const planArtifact = consultationPlanArtifactSchema.parse(
      JSON.parse(await readFile(planPath, "utf8")) as unknown,
    );
    const planMarkdownPath = join(
      cwd,
      ".oraculum",
      "runs",
      planned.id,
      "reports",
      "consultation-plan.md",
    );
    const planMarkdown = await readFile(planMarkdownPath, "utf8");
    const planReadinessPath = join(
      cwd,
      ".oraculum",
      "runs",
      planned.id,
      "reports",
      "plan-readiness.json",
    );
    const planReadiness = JSON.parse(await readFile(planReadinessPath, "utf8")) as {
      readyForConsult: boolean;
      status: string;
    };

    expect(planArtifact.mode).toBe("standard");
    expect(planReadiness).toMatchObject({
      readyForConsult: true,
      status: "clear",
    });
    expect(planArtifact.repoBasis.projectRoot).toBe(cwd);
    expect(planArtifact.repoBasis.signalFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(planArtifact.workstreams).toEqual([
      expect.objectContaining({
        id: "primary-contract",
        label: "Primary Contract",
        targetArtifacts: ["docs/PRD.md"],
        requiredChangedPaths: ["docs/PRD.md"],
      }),
    ]);
    expect(planArtifact.stagePlan).toEqual([
      expect.objectContaining({
        id: "primary-stage",
        label: "Primary Stage",
        workstreamIds: ["primary-contract"],
      }),
    ]);
    expect(planArtifact.scorecardDefinition.dimensions).toEqual(
      expect.arrayContaining([
        "target-artifact-coverage",
        "required-path-coverage",
        "oracle-pass-summary",
        "artifact-coherence",
      ]),
    );
    expect(planArtifact.repairPolicy).toMatchObject({
      maxAttemptsPerStage: 1,
      repairable: ["missing-target-coverage"],
    });
    expect(planArtifact.plannedJudgingCriteria).toEqual(
      expect.arrayContaining([
        "Directly improves docs/PRD.md instead of only adjacent files.",
        "Leaves the planned document result internally consistent and reviewable.",
      ]),
    );
    expect(planArtifact.crownGates).toEqual(
      expect.arrayContaining([
        "Do not recommend finalists that fail to materially change docs/PRD.md.",
        "Abstain if no finalist leaves the planned document result reviewable and internally consistent.",
      ]),
    );
    expect(planMarkdown).toContain("## Repo Basis");
    expect(planMarkdown).toContain("## Workstreams");
    expect(planMarkdown).toContain("## Stage Plan");
    expect(planMarkdown).toContain("## Scorecard Definition");
    expect(planMarkdown).toContain("## Repair Policy");
  });

  it("replays persisted plan presets into the run manifest and saved config", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_seed",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_seed", "reports"), { recursive: true });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
    await writeAdvancedConfig(cwd, {
      strategies: [
        {
          id: "minimal-change",
          label: "Minimal Change",
          description: "Keep the diff small.",
        },
        {
          id: "safety-first",
          label: "Safety First",
          description: "Prefer conservative edits.",
        },
      ],
      rounds: [
        {
          id: "fast",
          label: "Fast",
          description: "Quick checks.",
        },
        {
          id: "impact",
          label: "Impact",
          description: "Behavioral checks.",
        },
        {
          id: "deep",
          label: "Deep",
          description: "Expensive checks.",
        },
      ],
      oracles: [
        createOracle({
          id: "lint-fast",
          roundId: "fast",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          invariant: "lint passes",
        }),
        createOracle({
          id: "auth-impact",
          roundId: "impact",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          invariant: "auth checks pass",
        }),
        createOracle({
          id: "unused-deep",
          roundId: "deep",
          command: process.execPath,
          args: ["-e", "process.exit(1)"],
          invariant: "deep check",
        }),
      ],
    });
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_seed",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_seed/reports/consultation-plan.json`.",
          intendedResult: "recommended result for src/session.ts",
          decisionDrivers: ["Target artifact path: src/session.ts"],
          openQuestions: [],
          task: {
            id: "session",
            title: "Preserve session",
            intent: "Keep login state stable.",
            artifactKind: "code patch",
            targetArtifactPath: "src/session.ts",
            nonGoals: [],
            acceptanceCriteria: ["Refreshing the page preserves the session."],
            risks: ["Do not break logout."],
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
          profileSelection: {
            validationProfileId: "frontend",
            confidence: "high",
            source: "llm-recommendation",
            validationSummary: "Favor the planned auth checks only.",
            candidateCount: 2,
            strategyIds: ["planned-bridge", "planned-safety"],
            oracleIds: ["lint-fast", "auth-impact"],
            validationGaps: [],
            validationSignals: ["planned posture"],
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "planned-bridge",
              label: "Bridge Migration",
            },
            {
              id: "planned-safety",
              label: "Safety Guard",
            },
          ],
          oracleIds: ["lint-fast", "auth-impact"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
            {
              id: "impact",
              label: "Impact",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_seed");

    const planned = await planRun({
      cwd,
      taskInput: planPath,
      agent: "codex",
    });

    expect(planned.candidateCount).toBe(2);
    expect(planned.rounds.map((round) => round.id)).toEqual(["fast", "impact"]);
    expect(planned.candidates.map((candidate) => candidate.strategyId)).toEqual([
      "planned-bridge",
      "planned-safety",
    ]);
    expect(planned.candidates.map((candidate) => candidate.strategyLabel)).toEqual([
      "Bridge Migration",
      "Safety Guard",
    ]);
    expect(planned.profileSelection).toMatchObject({
      validationProfileId: "frontend",
      confidence: "high",
      source: "llm-recommendation",
      candidateCount: 2,
      strategyIds: ["planned-bridge", "planned-safety"],
      oracleIds: ["lint-fast", "auth-impact"],
    });
    expect(planned.configPath).toBeDefined();
    const { configPath } = planned;
    if (!configPath) {
      throw new Error("Expected planRun() to persist a config path.");
    }

    const savedConfig = projectConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")) as unknown,
    );
    expect(savedConfig.defaultCandidates).toBe(2);
    expect(savedConfig.strategies.map((strategy) => strategy.id)).toEqual([
      "planned-bridge",
      "planned-safety",
    ]);
    expect(savedConfig.rounds.map((round) => round.id)).toEqual(["fast", "impact"]);
    expect(savedConfig.oracles.map((oracle) => oracle.id)).toEqual(["lint-fast", "auth-impact"]);
  });

  it("replays run-local consultation config for auto-profile plan oracles", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const reportsDir = join(cwd, ".oraculum", "runs", "run_profile_plan", "reports");
    const planPath = join(reportsDir, "consultation-plan.json");
    const planConfigPath = join(reportsDir, "consultation-config.json");

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(reportsDir, { recursive: true });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
    await writeFile(
      planConfigPath,
      `${JSON.stringify(
        projectConfigSchema.parse({
          version: 1,
          defaultAgent: "codex",
          adapters: ["codex", "claude-code"],
          defaultCandidates: 2,
          strategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
              description: "Keep the diff small.",
            },
            {
              id: "safety-first",
              label: "Safety First",
              description: "Prefer conservative edits.",
            },
          ],
          rounds: [
            {
              id: "deep",
              label: "Deep",
              description: "Expensive checks.",
            },
          ],
          oracles: [
            createOracle({
              id: "full-suite-deep",
              roundId: "deep",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
              invariant: "full suite passes",
            }),
          ],
          repair: {
            enabled: true,
            maxAttemptsPerRound: 1,
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_profile_plan",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_profile_plan/reports/consultation-plan.json`.",
          intendedResult: "recommended survivor",
          decisionDrivers: ["Validation posture: library"],
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
          profileSelection: {
            validationProfileId: "library",
            confidence: "high",
            source: "llm-recommendation",
            validationSummary: "Use the generated full-suite oracle.",
            candidateCount: 2,
            strategyIds: ["minimal-change", "safety-first"],
            oracleIds: ["full-suite-deep"],
            validationGaps: [],
            validationSignals: ["saved profile oracle"],
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
            },
            {
              id: "safety-first",
              label: "Safety First",
            },
          ],
          oracleIds: ["full-suite-deep"],
          roundOrder: [
            {
              id: "deep",
              label: "Deep",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writePlanReadiness(cwd, "run_profile_plan");

    const planned = await planRun({
      cwd,
      taskInput: planPath,
      agent: "codex",
    });

    expect(planned.rounds.map((round) => round.id)).toEqual(["deep"]);
    expect(planned.candidateCount).toBe(2);
    expect(planned.configPath).toBeDefined();
    const { configPath } = planned;
    if (!configPath) {
      throw new Error("Expected planRun() to persist a config path.");
    }
    const savedConfig = projectConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")) as unknown,
    );
    expect(savedConfig.oracles.map((oracle) => oracle.id)).toEqual(["full-suite-deep"]);
  });
});
