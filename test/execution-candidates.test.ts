import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getAdvancedConfigPath,
  getCandidateAgentResultPath,
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getSecondOpinionWinnerSelectionPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createTempRoot,
  registerExecutionTempRootCleanup,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution candidates", () => {
  it(
    "executes candidates and persists agent run artifacts",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "fix-session-loss.md"),
        "# Fix session loss\nKeep auth.\n",
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.candidateResults[0]?.status).toBe("completed");
      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      expect(executed.manifest.candidates[0]?.workspaceMode).toBe("copy");
      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(executed.manifest.recommendedWinner?.confidence).toBe("high");
      expect(executed.manifest.recommendedWinner?.source).toBe("llm-judge");
      expect(executed.manifest.outcome?.type).toBe("recommended-survivor");
      expect(executed.manifest.outcome?.verificationLevel).toBe("standard");
      expect(executed.manifest.updatedAt).toBeTruthy();
      expect(executed.manifest.updatedAt).not.toBe(executed.manifest.createdAt);

      const savedManifest = await readRunManifest(cwd, planned.id);
      expect(savedManifest.status).toBe("completed");
      expect(savedManifest.candidates[0]?.status).toBe("promoted");
      expect(savedManifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(savedManifest.outcome?.type).toBe("recommended-survivor");
      expect(savedManifest.updatedAt).toBe(executed.manifest.updatedAt);

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
      const witness = witnessSchema.parse(
        JSON.parse(await readFile(witnessPath, "utf8")) as unknown,
      );
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
        targetResultLabel: string;
      };
      expect(comparisonJson.finalistCount).toBe(1);
      expect(comparisonJson.recommendedWinner?.candidateId).toBe("cand-01");
      expect(comparisonJson.targetResultLabel).toBe("recommended survivor");
      await expect(
        readFile(getFinalistComparisonMarkdownPath(cwd, planned.id), "utf8"),
      ).resolves.toContain("Finalist Comparison");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the primary winner recommendation while persisting an advisory second opinion",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "second-opinion.md"),
        "# Second opinion\nCheck the judge.\n",
      );
      await writeFile(
        getAdvancedConfigPath(cwd),
        `${JSON.stringify(
          {
            version: 1,
            judge: {
              secondOpinion: {
                enabled: true,
                adapter: "claude-code",
                triggers: ["many-changed-paths"],
                minChangedPaths: 1,
                minChangedLines: 200,
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex-second-opinion",
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
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 remains the primary recommendation."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );
      const fakeClaude = await writeNodeBinary(
        cwd,
        "fake-claude-second-opinion",
        `const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  process.stdout.write(JSON.stringify({
    decision: "abstain",
    confidence: "medium",
    summary: "A second opinion would wait for manual review before crowning."
  }));
} else {
  process.stdout.write(JSON.stringify({ summary: "unused" }));
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/second-opinion.md",
        agent: "codex",
        candidates: 1,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        claudeBinaryPath: fakeClaude,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.recommendedWinner?.candidateId).toBe("cand-01");
      expect(executed.manifest.recommendedWinner?.source).toBe("llm-judge");
      await expect(
        readFile(getSecondOpinionWinnerSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain('"agreement": "disagrees-select-vs-abstain"');
      await expect(
        readFile(getSecondOpinionWinnerSelectionPath(cwd, planned.id), "utf8"),
      ).resolves.toContain('"adapter": "claude-code"');
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "eliminates candidates when the adapter exits non-zero",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.candidateResults[0]?.status).toBe("failed");
      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();

      const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
      const verdict = oracleVerdictSchema.parse(
        JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
      );
      expect(verdict.status).toBe("fail");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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

  it(
    "eliminates candidates that never materialize a patch in the workspace",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "no-materialized-patch.md"),
        "# No patch\nExplain only.\n",
      );

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "ignores unmanaged runtime state files when checking for a materialized patch",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      expect(executed.manifest.recommendedWinner).toBeUndefined();
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
