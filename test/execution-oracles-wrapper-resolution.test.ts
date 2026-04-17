import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCandidateWitnessPath } from "../src/core/paths.js";
import { executeRun } from "../src/services/execution.js";
import { planRun } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createInitializedExecutionProject,
  createPatchedCodexBinary,
  registerExecutionTempRootCleanup,
  writeExecutionTask,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution oracles: wrapper resolution", () => {
  it(
    "runs repo-local command plus args oracles through the platform-safe default shell",
    async () => {
      const cwd = await createInitializedExecutionProject();
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
      await writeExecutionTask(cwd, "wrapper-oracle.md", "# Wrapper oracle\nRun wrapper.\n");

      const fakeCodex = await createPatchedCodexBinary(cwd);

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      await expect(
        readFile(
          join(cwd, ".oraculum", "workspaces", planned.id, "cand-01", "oracle-marker.txt"),
          "utf8",
        ),
      ).resolves.toBe("lint --strict");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "resolves bare repo-local Gradle wrappers without inheriting the global PATH",
    async () => {
      const cwd = await createInitializedExecutionProject();
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
      await writeExecutionTask(cwd, "gradle-wrapper.md", "# Gradle wrapper\nRun wrapper.\n");

      const fakeCodex = await createPatchedCodexBinary(cwd);

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
