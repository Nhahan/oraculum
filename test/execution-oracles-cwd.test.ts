import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCandidateOracleStderrLogPath } from "../src/core/paths.js";
import { executeRun } from "../src/services/execution.js";
import { planRun } from "../src/services/runs.js";
import {
  configureProjectOracles,
  createInitializedExecutionProject,
  createPatchedCodexBinary,
  createTempRoot,
  registerExecutionTempRootCleanup,
  writeExecutionTask,
} from "./helpers/execution.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution oracles: cwd safety", () => {
  it(
    "runs workspace-scoped repo-local oracles inside safe relative cwd values",
    async () => {
      const cwd = await createInitializedExecutionProject();
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
      await writeExecutionTask(
        cwd,
        "workspace-relative-cwd.md",
        "# Workspace relative cwd\nValidate nested package checks.\n",
      );

      const fakeCodex = await createPatchedCodexBinary(cwd, {
        candidateSetupLines: [
          'fs.writeFileSync(path.join(process.cwd(), "packages", "app", "candidate-change.txt"), "patched\\n", "utf8");',
        ],
      });

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "runs project-scoped repo-local oracles inside safe relative cwd values",
    async () => {
      const cwd = await createInitializedExecutionProject();
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
      await writeExecutionTask(
        cwd,
        "project-relative-cwd.md",
        "# Project relative cwd\nValidate project tool checks.\n",
      );

      const fakeCodex = await createPatchedCodexBinary(cwd);

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects repo-local oracle relative cwd symlink escapes",
    async () => {
      const cwd = await createInitializedExecutionProject();
      const outside = await createTempRoot();
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
      await writeExecutionTask(
        cwd,
        "escaped-relative-cwd.md",
        "# Escaped relative cwd\nReject symlink escape.\n",
      );

      const fakeCodex = await createPatchedCodexBinary(cwd);

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("eliminated");
      await expect(
        readFile(
          getCandidateOracleStderrLogPath(cwd, planned.id, "cand-01", "impact", "escaped-cwd"),
          "utf8",
        ),
      ).resolves.toContain("relativeCwd escapes the project scope");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
