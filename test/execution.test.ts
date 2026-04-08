import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
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
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
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
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
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
    ).resolves.toContain("Finalist Comparison");
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
    ? '{"candidateId":"cand-01","confidence":"high","summary":"this should never be used"}'
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
      '{"candidateId":"cand-01","confidence":"high","summary":"this should be ignored"}',
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
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 repaired its reviewable evidence."}'
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
    '{"profileId":"library","confidence":"high","summary":"Library scripts are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","unit-impact","full-suite-deep"],"missingCapabilities":[]}',
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
    ? '{"candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
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
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "impact", "unit-impact"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
    await expect(
      readFile(
        getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
        "utf8",
      ),
    ).resolves.toContain('"status": "pass"');
  });
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
