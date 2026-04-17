import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getCandidateOracleStderrLogPath,
  getCandidateOracleStdoutLogPath,
  getCandidateVerdictPath,
  getFinalistComparisonMarkdownPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import { planRun } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createInitializedExecutionProject,
  createPatchedCodexBinary,
  registerExecutionTempRootCleanup,
  writeExecutionTask,
} from "./helpers/execution.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution oracles: verdicts", () => {
  it(
    "runs repo-local hard-gate oracles and eliminates failing candidates",
    async () => {
      const cwd = await createInitializedExecutionProject();
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
      await writeExecutionTask(cwd, "repo-oracle.md", "# Repo oracle\nValidate impact.\n");

      const fakeCodex = await createPatchedCodexBinary(cwd, {
        winnerOutput: "not-json",
      });

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "runs repo-local signal oracles without blocking promotion",
    async () => {
      const cwd = await createInitializedExecutionProject();
      await configureProjectOracles(cwd, [
        {
          id: "comparison-signal",
          roundId: "impact",
          command: process.execPath,
          args: ["-e", "process.stderr.write('needs human review'); process.exit(9);"],
          invariant:
            "Comparison signals should be preserved even when they do not block promotion.",
          enforcement: "signal",
          failureSummary: "Candidate should still be promoted, but the signal must be preserved.",
        },
      ]);
      await writeExecutionTask(cwd, "signal-oracle.md", "# Signal oracle\nKeep going.\n");

      const fakeCodex = await createPatchedCodexBinary(cwd, {
        winnerOutput: "Codex finished candidate patch",
      });

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
