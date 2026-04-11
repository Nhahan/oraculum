import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getAdvancedConfigPath,
  getCandidateAgentResultPath,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateRepairAttemptResultPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import * as finalistReportService from "../src/services/finalist-report.js";
import { initializeProject } from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("run execution", () => {
  it("executes candidates and persists agent run artifacts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# Fix session loss\nKeep auth.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
process.stdout.write('{"event":"started"}\\n');
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
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.candidateResults[0]?.status).toBe("completed");
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.candidates[0]?.workspaceMode).toBe("copy");
    expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
    expect(executed.manifest.recommendedWinner?.confidence).toBe("high");
    expect(executed.manifest.recommendedWinner?.source).toBe("llm-judge");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");
    expect(savedManifest.candidates[0]?.status).toBe("promoted");
    expect(savedManifest.recommendedWinner?.candidateId).toBe("cand-01");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Codex finished candidate patch");

    const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("pass");
    expect(verdict.roundId).toBe("fast");

    const witnessPath = getCandidateWitnessPath(
      cwd,
      planned.id,
      "cand-01",
      "fast",
      "cand-01-agent-exit",
    );
    const witness = witnessSchema.parse(JSON.parse(await readFile(witnessPath, "utf8")) as unknown);
    expect(witness.detail).toContain("status=completed");
    expect(savedManifest.rounds.map((round) => round.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(savedManifest.rounds[0]?.verdictCount).toBeGreaterThan(0);
    expect(savedManifest.rounds[1]?.verdictCount).toBeGreaterThan(0);
    expect(savedManifest.rounds[2]?.verdictCount).toBe(0);

    const comparisonJson = JSON.parse(
      await readFile(getFinalistComparisonJsonPath(cwd, planned.id), "utf8"),
    ) as {
      recommendedWinner?: { candidateId: string };
      finalistCount: number;
    };
    expect(comparisonJson.finalistCount).toBe(1);
    expect(comparisonJson.recommendedWinner?.candidateId).toBe("cand-01");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.toContain("Survivor Comparison");
  }, 20_000);

  it("eliminates candidates when the adapter exits non-zero", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fail.md"), "# Fail\nReturn non-zero.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `process.stdout.write('{"event":"started"}\\n');
process.exit(3);
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/fail.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.candidateResults[0]?.status).toBe("failed");
    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();

    const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("fail");
  });

  it("marks the candidate terminal and completes the run when the host binary cannot start", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "missing-host.md"), "# Missing host\nFail to spawn.\n");

    const planned = await planRun({
      cwd,
      taskInput: "tasks/missing-host.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: join(cwd, "missing-codex"),
      timeoutMs: 5_000,
    });

    expect(executed.manifest.status).toBe("completed");
    expect(executed.candidateResults[0]?.status).toBe("failed");
    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");
    expect(savedManifest.candidates[0]?.status).toBe("eliminated");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Failed to start subprocess");
    expect(savedManifest.rounds[0]?.status).toBe("completed");
    expect(savedManifest.rounds[0]?.eliminatedCount).toBe(1);
  });

  it("skips repo-local oracles when the candidate agent run already failed", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "missing-host.md"), "# Missing host\nFail to spawn.\n");
    await configureProjectOracles(cwd, [
      {
        id: "workspace-sanity",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.exit(0);"],
        invariant: "Impact checks should only run for completed candidates.",
        enforcement: "hard",
      },
    ]);

    const planned = await planRun({
      cwd,
      taskInput: "tasks/missing-host.md",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: join(cwd, "missing-codex"),
      timeoutMs: 5_000,
    });

    await expect(
      readFile(
        getCandidateOracleStdoutLogPath(cwd, planned.id, "cand-01", "impact", "workspace-sanity"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(
        getCandidateOracleStderrLogPath(cwd, planned.id, "cand-01", "impact", "workspace-sanity"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("eliminates candidates that never materialize a patch in the workspace", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "no-materialized-patch.md"), "# No patch\nExplain only.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"this should never be used"}'
    : "I would update src/greet.js, but I am only describing the patch.";
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/no-materialized-patch.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "materialized-patch",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("repairable");
    expect(verdict.summary).toContain("did not leave materialized file changes");
  });

  it("ignores unmanaged runtime state files when checking for a materialized patch", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "unmanaged-only.md"),
      "# Unmanaged only\nWrite runtime state only.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), ".omc"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), ".omc", "project-memory.json"), '{"runtime":"state"}', "utf8");
if (out) {
  fs.writeFileSync(out, "runtime state only", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/unmanaged-only.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
  });

  it("runs repo-local hard-gate oracles and eliminates failing candidates", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "workspace-sanity",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.stderr.write('missing expected file'); process.exit(7);"],
        invariant: "Impact checks must pass before promotion.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "repo-oracle.md"), "# Repo oracle\nValidate impact.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
    ? "not-json"
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/repo-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "workspace-sanity",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.severity).toBe("error");

    const stderrPath = getCandidateOracleStderrLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "workspace-sanity",
    );
    expect(await readFile(stderrPath, "utf8")).toContain("missing expected file");
  });

  it("runs workspace-scoped repo-local oracles inside safe relative cwd values", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", "README.md"), "app package\n", "utf8");
    await configureProjectOracles(cwd, [
      {
        id: "workspace-package-cwd",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const expected = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'packages', 'app');",
            "if (fs.realpathSync(process.cwd()) !== fs.realpathSync(expected)) { console.error('cwd=' + process.cwd() + ' expected=' + expected); process.exit(2); }",
            "if (fs.realpathSync(process.env.ORACULUM_ORACLE_CWD) !== fs.realpathSync(expected)) { console.error('oracle cwd env mismatch'); process.exit(3); }",
            "if (!fs.existsSync(path.join(process.cwd(), 'candidate-change.txt'))) { console.error('missing nested candidate change'); process.exit(4); }",
          ].join(" "),
        ],
        cwd: "workspace",
        relativeCwd: "packages/app",
        invariant: "Workspace-scoped oracles may run in a safe nested package directory.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "workspace-relative-cwd.md"),
      "# Workspace relative cwd\nValidate nested package checks.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.writeFileSync(path.join(process.cwd(), "packages", "app", "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/workspace-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("runs project-scoped repo-local oracles inside safe relative cwd values", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "tools"), { recursive: true });
    await writeFile(join(cwd, "tools", "project-marker.txt"), "project tool\n", "utf8");
    await configureProjectOracles(cwd, [
      {
        id: "project-tool-cwd",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            "const expected = path.join(process.env.ORACULUM_PROJECT_ROOT, 'tools');",
            "if (fs.realpathSync(process.cwd()) !== fs.realpathSync(expected)) { console.error('cwd=' + process.cwd() + ' expected=' + expected); process.exit(2); }",
            "if (fs.realpathSync(process.env.ORACULUM_ORACLE_CWD) !== fs.realpathSync(expected)) { console.error('oracle cwd env mismatch'); process.exit(3); }",
            "if (!fs.existsSync(path.join(process.cwd(), 'project-marker.txt'))) { console.error('missing project marker'); process.exit(4); }",
          ].join(" "),
        ],
        cwd: "project",
        relativeCwd: "tools",
        invariant: "Project-scoped oracles may run in a safe nested project tool directory.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "project-relative-cwd.md"),
      "# Project relative cwd\nValidate project tool checks.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/project-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("rejects repo-local oracle relative cwd symlink escapes", async () => {
    const cwd = await createTempRoot();
    const outside = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await symlink(
      outside,
      join(cwd, "escaped-cwd"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await configureProjectOracles(cwd, [
      {
        id: "escaped-cwd",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.exit(0);"],
        cwd: "project",
        relativeCwd: "escaped-cwd",
        invariant:
          "Relative oracle cwd must stay inside the selected scope after symlink resolution.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "escaped-relative-cwd.md"),
      "# Escaped relative cwd\nReject symlink escape.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/escaped-relative-cwd.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
    await expect(
      readFile(
        getCandidateOracleStderrLogPath(cwd, planned.id, "cand-01", "impact", "escaped-cwd"),
        "utf8",
      ),
    ).resolves.toContain("relativeCwd escapes the project scope");
  }, 20_000);

  it("runs repo-local signal oracles without blocking promotion", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "comparison-signal",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", "process.stderr.write('needs human review'); process.exit(9);"],
        invariant: "Comparison signals should be preserved even when they do not block promotion.",
        enforcement: "signal",
        failureSummary: "Candidate should still be promoted, but the signal must be preserved.",
      },
    ]);
    await writeFile(join(cwd, "tasks", "signal-oracle.md"), "# Signal oracle\nKeep going.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/signal-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner?.source).toBe("fallback-policy");

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("pass");
    expect(verdict.severity).toBe("warning");

    const stdoutPath = getCandidateOracleStdoutLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    const stderrPath = getCandidateOracleStderrLogPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "comparison-signal",
    );
    expect(await readFile(stdoutPath, "utf8")).toBe("");
    expect(await readFile(stderrPath, "utf8")).toContain("needs human review");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.toContain("fallback-policy");
  }, 20_000);

  it("runs repo-local command plus args oracles through the platform-safe default shell", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    const fakeOracle = await writeNodeBinary(
      cwd,
      "fake-oracle",
      `const fs = require("node:fs");
const path = require("node:path");
const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, "oracle-marker.txt");
fs.writeFileSync(marker, process.argv.slice(2).join(" "), "utf8");
process.stdout.write("oracle ok");
`,
    );
    await configureProjectOracles(cwd, [
      {
        id: "wrapper-oracle",
        roundId: "impact",
        command: fakeOracle,
        args: ["lint", "--strict"],
        invariant: "Repo-local wrapper commands should run across supported platforms.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "wrapper-oracle.md"), "# Wrapper oracle\nRun wrapper.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/wrapper-oracle.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    await expect(
      readFile(
        join(cwd, ".oraculum", "workspaces", planned.id, "cand-01", "oracle-marker.txt"),
        "utf8",
      ),
    ).resolves.toBe("lint --strict");
  }, 20_000);

  it("builds oracle PATH from existing local tool directories only", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "local-tool-paths",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const { delimiter, join } = require('node:path');",
            "const entries = (process.env.PATH || '').split(delimiter);",
            "const workspaceVenv = join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');",
            "const projectNodeBin = join(process.env.ORACULUM_PROJECT_ROOT, 'node_modules', '.bin');",
            "if (!entries.includes(workspaceVenv)) { console.error('missing workspace venv'); process.exit(2); }",
            "if (entries.includes(projectNodeBin)) { console.error('unexpected project node_modules bin'); process.exit(3); }",
          ].join(" "),
        ],
        invariant: "Repo-local oracle PATH should include only existing local tool directories.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "local-tool-paths.md"), "# Local tool paths\nCheck PATH.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts" : "bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/local-tool-paths.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("orders candidate-local oracle PATH entries before project-root local tools", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await configureProjectOracles(cwd, [
      {
        id: "candidate-tool-path-precedence",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "const { delimiter, join } = require('node:path');",
            "const entries = (process.env.PATH || '').split(delimiter);",
            "const candidateNodeBin = join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'node_modules', '.bin');",
            "const projectNodeBin = join(process.env.ORACULUM_PROJECT_ROOT, 'node_modules', '.bin');",
            "const candidateIndex = entries.indexOf(candidateNodeBin);",
            "const projectIndex = entries.indexOf(projectNodeBin);",
            "if (candidateIndex < 0) { console.error('missing candidate node_modules bin'); process.exit(2); }",
            "if (projectIndex < 0) { console.error('missing project node_modules bin'); process.exit(3); }",
            "if (candidateIndex >= projectIndex) { console.error('candidate tools should precede project tools'); process.exit(4); }",
          ].join(" "),
        ],
        invariant: "Candidate-local tools should take precedence over project-root tools.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "candidate-tool-path-precedence.md"),
      "# Candidate tool path precedence\nCheck PATH order.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), "node_modules", ".bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/candidate-tool-path-precedence.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("preserves an explicit empty oracle PATH override over local tool directory injection", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "empty-path",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "if (process.env.PATH !== '') {",
            "  console.error('expected empty PATH, received: ' + process.env.PATH);",
            "  process.exit(2);",
            "}",
          ].join(" "),
        ],
        env: {
          PATH: "",
        },
        invariant: "Explicit oracle PATH overrides should be preserved.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "empty-path.md"), "# Empty PATH\nCheck env override.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
fs.mkdirSync(path.join(process.cwd(), "node_modules", ".bin"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/empty-path.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
  }, 20_000);

  it("does not inherit global oracle PATH unless the oracle opts in", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    const globalBin = join(cwd, "global-bin");
    const pathExpectationScript = (expected: boolean) =>
      [
        "const { delimiter } = require('node:path');",
        `const sentinel = ${JSON.stringify(globalBin)};`,
        "const entries = (process.env.PATH || '').split(delimiter).filter(Boolean);",
        `if (entries.includes(sentinel) !== ${expected}) {`,
        "  console.error('unexpected PATH entries: ' + entries.join('|'));",
        "  process.exit(2);",
        "}",
      ].join(" ");
    await configureProjectOracles(cwd, [
      {
        id: "local-path-only",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", pathExpectationScript(false)],
        invariant: "Repo-local oracles should not inherit global PATH by default.",
        enforcement: "hard",
      },
      {
        id: "inherit-path",
        roundId: "impact",
        command: process.execPath,
        args: ["-e", pathExpectationScript(true)],
        pathPolicy: "inherit",
        invariant: "Repo-local oracles can explicitly inherit global PATH.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "path-policy.md"), "# PATH policy\nCheck oracle PATH.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/path-policy.md",
      agent: "codex",
      candidates: 1,
    });

    const originalPath = process.env.PATH;
    process.env.PATH = [globalBin, originalPath].filter((entry) => entry).join(delimiter);
    try {
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      await expect(
        readFile(
          getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-local-path-only"),
          "utf8",
        ),
      ).resolves.toContain("PathPolicy=local-only");
      await expect(
        readFile(
          getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-inherit-path"),
          "utf8",
        ),
      ).resolves.toContain("PathPolicy=inherit");
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  }, 20_000);

  it("does not leak unrelated host environment variables into repo-local oracles", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureProjectOracles(cwd, [
      {
        id: "host-env-isolation",
        roundId: "impact",
        command: process.execPath,
        args: [
          "-e",
          [
            "if (process.env.ORACULUM_TEST_HOST_SECRET) {",
            "  console.error('unexpected leaked env');",
            "  process.exit(2);",
            "}",
          ].join(" "),
        ],
        invariant:
          "Repo-local oracles should only receive deterministic Oraculum env plus explicit overrides.",
        enforcement: "hard",
      },
    ]);
    await writeFile(
      join(cwd, "tasks", "host-env-isolation.md"),
      "# Host env isolation\nCheck env.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/host-env-isolation.md",
      agent: "codex",
      candidates: 1,
    });

    const originalSecret = process.env.ORACULUM_TEST_HOST_SECRET;
    process.env.ORACULUM_TEST_HOST_SECRET = "should-not-leak";
    try {
      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ORACULUM_TEST_HOST_SECRET;
      } else {
        process.env.ORACULUM_TEST_HOST_SECRET = originalSecret;
      }
    }
  }, 20_000);

  it("resolves bare repo-local Gradle wrappers without inheriting the global PATH", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeNodeBinary(
      cwd,
      "gradlew",
      `const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, "gradle-wrapper-marker.txt"), process.argv.slice(2).join(" "), "utf8");
`,
    );
    await configureProjectOracles(cwd, [
      {
        id: "gradle-wrapper",
        roundId: "impact",
        command: "gradlew",
        args: ["test"],
        invariant: "Repo-local Gradle wrappers should resolve from the repository checkout.",
        enforcement: "hard",
      },
    ]);
    await writeFile(join(cwd, "tasks", "gradle-wrapper.md"), "# Gradle wrapper\nRun wrapper.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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
      taskInput: "tasks/gradle-wrapper.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    await expect(
      readFile(
        join(cwd, ".oraculum", "workspaces", planned.id, "cand-01", "gradle-wrapper-marker.txt"),
        "utf8",
      ),
    ).resolves.toBe("test");
    await expect(
      readFile(
        getCandidateWitnessPath(cwd, planned.id, "cand-01", "impact", "cand-01-gradle-wrapper"),
        "utf8",
      ),
    ).resolves.toContain("ResolvedCommand=");
  }, 20_000);

  it("falls back to deterministic winner selection when the judge exits non-zero", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "judge-failure.md"), "# Judge failure\nUse fallback.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(
      out,
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"this should be ignored"}',
      "utf8",
    );
    process.exit(7);
  }

  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/judge-failure.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
    expect(executed.manifest.recommendedWinner?.source).toBe("fallback-policy");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.toContain("fallback-policy");
  });

  it("keeps finalists but leaves no recommendation when the judge abstains", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "judge-abstains.md"),
      "# Judge abstains\nDo not force a winner.\n",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  if (prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(
      out,
      '{"decision":"abstain","confidence":"low","summary":"The finalists are too weak to recommend a safe promotion."}',
      "utf8",
    );
    process.exit(0);
  }

  fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/judge-abstains.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.recommendedWinner).toBeUndefined();
    await expect(
      readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
    ).resolves.not.toContain("fallback-policy");
  });

  it("runs a bounded repair loop for repairable verdicts before promoting a finalist", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await configureAdvancedConfig(cwd, {
      repair: {
        enabled: true,
        maxAttemptsPerRound: 1,
      },
      oracles: [
        {
          id: "needs-patch-report",
          roundId: "impact",
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'repair-fixed.txt');",
              "if (fs.existsSync(marker)) { process.stdout.write('repair fixed'); process.exit(0); }",
              "process.stderr.write('missing repair marker'); process.exit(1);",
            ].join(" "),
          ],
          invariant: "The candidate should leave a stronger reviewable artifact after repair.",
          enforcement: "repairable",
          repairHint: "Produce the missing review marker.",
        },
      ],
    });
    await writeFile(join(cwd, "tasks", "repair-loop.md"), "# Repair loop\nRepair when needed.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("Repair context:")) {
  fs.writeFileSync(path.join(process.cwd(), "repair-fixed.txt"), "ok", "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 repaired its reviewable evidence."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "tasks/repair-loop.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.candidates[0]?.repairCount).toBe(1);
    expect(executed.manifest.candidates[0]?.repairedRounds).toEqual(["impact"]);
    const repairResultPath = getCandidateRepairAttemptResultPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      1,
    );
    const repairResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(repairResultPath, "utf8")) as unknown,
    );
    expect(repairResult.status).toBe("completed");

    const verdictPath = getCandidateVerdictPath(
      cwd,
      planned.id,
      "cand-01",
      "impact",
      "needs-patch-report",
    );
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("pass");
    const comparison = JSON.parse(
      await readFile(getFinalistComparisonJsonPath(cwd, planned.id), "utf8"),
    ) as {
      finalists: Array<{
        candidateId: string;
        verdictCounts: { repairable: number };
      }>;
    };
    expect(comparison.finalists[0]?.candidateId).toBe("cand-01");
    expect(comparison.finalists[0]?.verdictCounts.repairable).toBeGreaterThanOrEqual(1);
  });

  it("uses consultation-scoped auto profile oracles during execution", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-library.md"), "# Fix\nUpdate the library output.\n");
    await writeLibraryProfileProject(cwd);

    const fakeProfileCodex = await writeNodeBinary(
      cwd,
      "fake-codex-profile",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","pack-impact","full-suite-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const fakeCandidateCodex = await writeNodeBinary(
      cwd,
      "fake-codex-candidate",
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
  fs.writeFileSync(path.join(process.cwd(), "src", "index.js"), 'export function greet() {\\n  return "Hello";\\n}\\n', "utf8");
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
      taskInput: "tasks/fix-library.md",
      agent: "codex",
      candidates: 1,
      autoProfile: {
        codexBinaryPath: fakeProfileCodex,
        timeoutMs: 5_000,
      },
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCandidateCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.profileSelection?.profileId).toBe("library");
    expect(executed.manifest.rounds[0]?.verdictCount).toBeGreaterThanOrEqual(4);
    expect(executed.manifest.rounds[1]?.verdictCount).toBeGreaterThanOrEqual(3);
    expect(executed.manifest.rounds[2]?.verdictCount).toBeGreaterThanOrEqual(1);

    await expect(
      readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "typecheck-fast"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "impact", "pack-impact"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
  }, 20_000);

  it("runs consultation-scoped workspace package script oracles inside the selected workspace cwd", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix-workspace-library.md"),
      "# Fix\nUpdate the workspace output.\n",
    );
    await writeWorkspaceLibraryProfileProject(cwd);

    const fakeProfileCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-profile",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Workspace package scripts are present.","candidateCount":3,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","full-suite-deep"],"missingCapabilities":["No package packaging smoke check was detected."]}',
    "utf8",
  );
}
`,
    );

    const fakeCandidateCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-candidate",
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
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "app", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
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
      taskInput: "tasks/fix-workspace-library.md",
      agent: "codex",
      candidates: 1,
      autoProfile: {
        codexBinaryPath: fakeProfileCodex,
        timeoutMs: 5_000,
      },
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCandidateCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.profileSelection?.profileId).toBe("library");
    expect(executed.manifest.profileSelection?.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");

    const configPath = executed.manifest.configPath;
    expect(configPath).toBeDefined();
    if (!configPath) {
      throw new Error("expected consultation config path to be recorded");
    }
    const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
      oracles?: Array<{ id: string; relativeCwd?: string }>;
    };
    expect(configRaw.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lint-fast", relativeCwd: "packages/app" }),
        expect.objectContaining({ id: "full-suite-deep", relativeCwd: "packages/app" }),
      ]),
    );
    await expect(
      readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
  }, 20_000);

  it("runs consultation-scoped workspace-local entrypoint oracles inside the selected workspace cwd", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix-workspace-entrypoints.md"),
      "# Fix\nUpdate the workspace output.\n",
    );
    await writeWorkspaceLocalEntrypointProfileProject(cwd);

    const fakeProfileCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-entrypoint-profile",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Workspace-local entrypoints are present.","candidateCount":3,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","full-suite-deep"],"missingCapabilities":["No package packaging smoke check was detected."]}',
    "utf8",
  );
}
`,
    );

    const fakeCandidateCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-entrypoint-candidate",
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
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "app", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
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
      taskInput: "tasks/fix-workspace-entrypoints.md",
      agent: "codex",
      candidates: 1,
      autoProfile: {
        codexBinaryPath: fakeProfileCodex,
        timeoutMs: 5_000,
      },
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCandidateCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.profileSelection?.profileId).toBe("library");
    expect(executed.manifest.profileSelection?.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");

    const configPath = executed.manifest.configPath;
    expect(configPath).toBeDefined();
    if (!configPath) {
      throw new Error("expected consultation config path to be recorded");
    }
    const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
      oracles?: Array<{ id: string; relativeCwd?: string }>;
    };
    expect(configRaw.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lint-fast", relativeCwd: "packages/app" }),
        expect.objectContaining({ id: "full-suite-deep", relativeCwd: "packages/app" }),
      ]),
    );
    await expect(
      readFile(
        join(
          cwd,
          ".oraculum",
          "workspaces",
          planned.id,
          "cand-01",
          "packages",
          "app",
          "lint-marker.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("lint");
    await expect(
      readFile(
        join(
          cwd,
          ".oraculum",
          "workspaces",
          planned.id,
          "cand-01",
          "packages",
          "app",
          "test-marker.txt",
        ),
        "utf8",
      ),
    ).resolves.toBe("test");
  }, 20_000);

  it("runs workspace package export smoke oracles inside the selected workspace cwd", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(
      join(cwd, "tasks", "fix-workspace-pack.md"),
      "# Fix\nUpdate the workspace package output.\n",
    );
    await writeWorkspaceExportableNpmLibraryProfileProject(cwd);

    const fakeProfileCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-pack-profile",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Workspace package scripts and export metadata are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","pack-impact","full-suite-deep","package-smoke-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const fakeCandidateCodex = await writeNodeBinary(
      cwd,
      "fake-codex-workspace-pack-candidate",
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
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "lib", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
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
      taskInput: "tasks/fix-workspace-pack.md",
      agent: "codex",
      candidates: 1,
      autoProfile: {
        codexBinaryPath: fakeProfileCodex,
        timeoutMs: 5_000,
      },
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCandidateCodex,
      timeoutMs: 5_000,
    });

    expect(executed.manifest.profileSelection?.profileId).toBe("library");
    expect(executed.manifest.profileSelection?.oracleIds).toEqual([
      "lint-fast",
      "pack-impact",
      "full-suite-deep",
      "package-smoke-deep",
    ]);
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");

    const configPath = executed.manifest.configPath;
    expect(configPath).toBeDefined();
    if (!configPath) {
      throw new Error("expected consultation config path to be recorded");
    }
    const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
      oracles?: Array<{ id: string; relativeCwd?: string }>;
    };
    expect(configRaw.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "lint-fast", relativeCwd: "packages/lib" }),
        expect.objectContaining({ id: "pack-impact", relativeCwd: "packages/lib" }),
        expect.objectContaining({ id: "full-suite-deep", relativeCwd: "packages/lib" }),
        expect.objectContaining({ id: "package-smoke-deep", relativeCwd: "packages/lib" }),
      ]),
    );
    await expect(
      readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "impact", "pack-impact"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "package-smoke-deep"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
  }, 20_000);

  it("does not advance latest consultation pointers when comparison reporting fails", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# Fix session loss\nKeep auth.\n");

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
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

    const reportSpy = vi
      .spyOn(finalistReportService, "writeFinalistComparisonReport")
      .mockRejectedValueOnce(new Error("report write failed"));

    try {
      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });

      await expect(
        executeRun({
          cwd,
          runId: planned.id,
          codexBinaryPath: fakeCodex,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow("report write failed");

      await expect(readFile(getLatestRunStatePath(cwd), "utf8")).rejects.toThrow();
      await expect(readFile(getLatestExportableRunStatePath(cwd), "utf8")).rejects.toThrow();
    } finally {
      reportSpy.mockRestore();
    }
  }, 20_000);
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-execution-"));
  tempRoots.push(path);
  return path;
}

async function writeLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "execution-library",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        type: "module",
        exports: "./src/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(cwd, "src", "index.js"), 'export function greet() {\n  return "Bye";\n}\n');
  await writeFile(
    join(cwd, "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeWorkspaceLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "app", "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "execution-workspace-root",
        packageManager: "pnpm@10.0.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "package.json"),
    `${JSON.stringify(
      {
        name: "@acme/app",
        version: "1.0.0",
        type: "module",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeWorkspaceLocalEntrypointProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "app", "src"), { recursive: true });
  await writeFile(
    join(cwd, "packages", "app", "pyproject.toml"),
    "[project]\nname='app'\n",
    "utf8",
  );
  await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
  await mkdir(join(cwd, "packages", "app", "scripts"), { recursive: true });
  await writeNodeBinary(
    join(cwd, "packages", "app", "bin"),
    "lint",
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "fs.writeFileSync(path.join(process.cwd(), 'lint-marker.txt'), 'lint', 'utf8');",
    ].join("\n"),
  );
  await writeNodeBinary(
    join(cwd, "packages", "app", "scripts"),
    "test",
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "fs.writeFileSync(path.join(process.cwd(), 'test-marker.txt'), 'test', 'utf8');",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "packages", "app", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
}

async function writeWorkspaceExportableNpmLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "lib", "src"), { recursive: true });
  await writeFile(
    join(cwd, "packages", "lib", "package.json"),
    `${JSON.stringify(
      {
        name: "@acme/lib",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        type: "module",
        exports: "./src/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "lib", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "lib", "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function configureProjectOracles(cwd: string, oracles: unknown[]): Promise<void> {
  await configureAdvancedConfig(cwd, { oracles });
}

async function configureAdvancedConfig(
  cwd: string,
  update: Record<string, unknown>,
): Promise<void> {
  const configPath = getAdvancedConfigPath(cwd);
  const parsed = await readAdvancedConfig(configPath);
  await writeFile(configPath, `${JSON.stringify({ ...parsed, ...update }, null, 2)}\n`, "utf8");
}

async function readAdvancedConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { version: 1 };
  }
}
