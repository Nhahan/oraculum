import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCandidateVerdictPath } from "../src/core/paths.js";
import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  createOracle,
  createTempProject,
  writeAdvancedConfig,
  writePlanReadiness,
} from "./helpers/consultation-plan-execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

describe("consultation plan execution presets", () => {
  it(
    "executes only the planned rounds and repo-local oracles",
    async () => {
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
      await writePlanReadiness(cwd, "run_exec");

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
        stat(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-target-artifact"),
        ),
      ).rejects.toThrow();
      await expect(
        stat(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-protected-paths"),
        ),
      ).resolves.toBeTruthy();
      await expect(
        stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "planned-fast")),
      ).resolves.toBeTruthy();
      await expect(
        stat(getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "unplanned-deep")),
      ).rejects.toThrow();
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates that do not touch the planned target artifact",
    async () => {
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
      await writePlanReadiness(cwd, "run_target_guard");

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates that miss required changed paths from the consultation plan",
    async () => {
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
      await writePlanReadiness(cwd, "run_required_paths");

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates that change protected paths from the consultation plan",
    async () => {
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
      await writePlanReadiness(cwd, "run_protected_paths");

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
