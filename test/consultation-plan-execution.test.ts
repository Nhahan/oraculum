import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAdvancedConfigPath,
  getCandidateScorecardPath,
  getCandidateVerdictPath,
} from "../src/core/paths.js";
import { projectConfigSchema } from "../src/domain/config.js";
import { candidateScorecardSchema, consultationPlanArtifactSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-consultation-plan-");
tempRootHarness.registerCleanup();

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

    expect(planArtifact.mode).toBe("standard");
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

  it("executes only the planned rounds and repo-local oracles", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_exec",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_exec", "reports"), { recursive: true });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
    await writeAdvancedConfig(cwd, {
      oracles: [
        createOracle({
          id: "planned-fast",
          roundId: "fast",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          invariant: "planned fast check",
        }),
        createOracle({
          id: "unplanned-deep",
          roundId: "deep",
          command: process.execPath,
          args: ["-e", "process.exit(1)"],
          invariant: "unplanned deep check",
        }),
      ],
    });
    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_exec",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_exec/reports/consultation-plan.json`.",
          intendedResult: "recommended survivor",
          decisionDrivers: [],
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
          profileSelection: {
            validationProfileId: "generic",
            confidence: "high",
            source: "llm-recommendation",
            validationSummary: "Use only the planned fast oracle.",
            candidateCount: 1,
            strategyIds: ["planned-fast-pass"],
            oracleIds: ["planned-fast"],
            validationGaps: [],
            validationSignals: ["planned fast oracle only"],
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-fast-pass",
              label: "Planned Fast Pass",
            },
          ],
          oracleIds: ["planned-fast"],
          requiredChangedPaths: ["candidate-change.txt"],
          protectedPaths: ["docs/KEEP.md"],
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

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex-plan",
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
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
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
      timeoutMs: 5_000,
    });

    expect(executed.manifest.rounds.map((round) => round.id)).toEqual(["fast"]);
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
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
    ).resolves.toBeTruthy();
    await expect(
      stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-target-artifact")),
    ).rejects.toThrow();
    await expect(
      stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-protected-paths")),
    ).resolves.toBeTruthy();
    await expect(
      stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-fast")),
    ).resolves.toBeTruthy();
    await expect(
      stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "unplanned-deep")),
    ).rejects.toThrow();
  }, 20_000);

  it("eliminates candidates that do not touch the planned target artifact", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_target_guard",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_target_guard", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
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
          runId: "run_target_guard",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_target_guard/reports/consultation-plan.json`.",
          intendedResult: "recommended result for src/session.ts",
          decisionDrivers: ["Target artifact path: src/session.ts"],
          openQuestions: [],
          task: {
            id: "session",
            title: "Preserve session",
            intent: "Keep login state stable.",
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
            validationSummary: "Preserve the planned target artifact.",
            candidateCount: 1,
            strategyIds: ["planned-targeted"],
            oracleIds: [],
            validationGaps: [],
            validationSignals: ["planned target artifact"],
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-targeted",
              label: "Planned Targeted Change",
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

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex-plan-target-guard",
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
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
    expect(executed.manifest.outcome?.type).toBe("no-survivors");

    const plannedTargetVerdict = JSON.parse(
      await readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-target-artifact"),
        "utf8",
      ),
    ) as {
      status: string;
      summary: string;
    };
    expect(plannedTargetVerdict.status).toBe("repairable");
    expect(plannedTargetVerdict.summary).toContain("src/session.ts");
  }, 20_000);

  it("eliminates candidates that miss required changed paths from the consultation plan", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_required_paths",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_required_paths", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
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
          runId: "run_required_paths",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_required_paths/reports/consultation-plan.json`.",
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
            risks: ["Do not miss the follow-up test file."],
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
            validationSummary: "Change both required files.",
            candidateCount: 1,
            strategyIds: ["planned-targeted"],
            oracleIds: [],
            validationGaps: [],
            validationSignals: ["required changed paths"],
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-targeted",
              label: "Planned Targeted Change",
            },
          ],
          oracleIds: [],
          requiredChangedPaths: ["candidate-change.txt", "candidate-followup.txt"],
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

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex-plan-required-paths",
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
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
    expect(executed.manifest.outcome?.type).toBe("no-survivors");

    const requiredPathsVerdict = JSON.parse(
      await readFile(
        getCandidateVerdictPath(
          cwd,
          planned.id,
          "cand-01",
          "fast",
          "planned-required-changed-paths",
        ),
        "utf8",
      ),
    ) as {
      status: string;
      summary: string;
    };
    expect(requiredPathsVerdict.status).toBe("repairable");
    expect(requiredPathsVerdict.summary).toContain("candidate-followup.txt");
  }, 20_000);

  it("eliminates candidates that change protected paths from the consultation plan", async () => {
    const cwd = await createTempProject();
    const taskPath = join(cwd, "tasks", "session.md");
    const planPath = join(
      cwd,
      ".oraculum",
      "runs",
      "run_protected_paths",
      "reports",
      "consultation-plan.json",
    );

    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tasks"), { recursive: true });
    await mkdir(join(cwd, ".oraculum", "runs", "run_protected_paths", "reports"), {
      recursive: true,
    });
    await writeFile(taskPath, "# Preserve session\nKeep login state stable.\n", "utf8");
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
          runId: "run_protected_paths",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_protected_paths/reports/consultation-plan.json`.",
          intendedResult: "recommended result for candidate-change.txt",
          decisionDrivers: ["Target artifact path: candidate-change.txt"],
          openQuestions: [],
          task: {
            id: "session",
            title: "Preserve session",
            intent: "Keep login state stable.",
            targetArtifactPath: "candidate-change.txt",
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
            validationSummary: "Preserve the protected docs path.",
            candidateCount: 1,
            strategyIds: ["planned-targeted"],
            oracleIds: [],
            validationGaps: [],
            validationSignals: ["protected path contract"],
          },
          candidateCount: 1,
          plannedStrategies: [
            {
              id: "planned-targeted",
              label: "Planned Targeted Change",
            },
          ],
          oracleIds: [],
          protectedPaths: ["docs/KEEP.md"],
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

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex-plan-protected-paths",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
fs.mkdirSync(path.join(process.cwd(), "docs"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "docs", "KEEP.md"), "should not change\\n", "utf8");
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
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
    expect(executed.manifest.outcome?.type).toBe("no-survivors");

    const protectedPathVerdict = JSON.parse(
      await readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-protected-paths"),
        "utf8",
      ),
    ) as {
      status: string;
      summary: string;
    };
    expect(protectedPathVerdict.status).toBe("repairable");
    expect(protectedPathVerdict.summary).toContain("docs/KEEP.md");
  }, 20_000);

  it("persists candidate scorecards for complex consultation plans", async () => {
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
      timeoutMs: 5_000,
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
  }, 20_000);

  it("eliminates candidates when complex workstream coverage is missing even without top-level path guards", async () => {
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
      timeoutMs: 5_000,
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
  }, 20_000);

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

    await expect(
      planRun({
        cwd,
        taskInput: planPath,
        agent: "codex",
      }),
    ).rejects.toThrow(/contains a stage dependency cycle/);
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
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/missing or invalid consultation plan artifact/);
  });
});

async function createTempProject(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

async function writeAdvancedConfig(
  cwd: string,
  overrides: {
    oracles?: unknown[];
    repair?: unknown;
    rounds?: unknown[];
    strategies?: unknown[];
  },
): Promise<void> {
  await writeFile(
    getAdvancedConfigPath(cwd),
    `${JSON.stringify(
      {
        version: 1,
        ...(overrides.repair ? { repair: overrides.repair } : {}),
        ...(overrides.strategies ? { strategies: overrides.strategies } : {}),
        ...(overrides.rounds ? { rounds: overrides.rounds } : {}),
        ...(overrides.oracles ? { oracles: overrides.oracles } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function createOracle(options: {
  id: string;
  roundId: "fast" | "impact" | "deep";
  command: string;
  args: string[];
  invariant: string;
}) {
  return {
    id: options.id,
    roundId: options.roundId,
    command: options.command,
    args: options.args,
    invariant: options.invariant,
    cwd: "workspace",
    enforcement: "hard",
    confidence: "high",
  };
}
