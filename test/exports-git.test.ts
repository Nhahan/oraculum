import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCandidateManifestPath,
  getExportPatchPath,
  getExportPlanPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { exportPlanSchema, runManifestSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { materializeExport } from "../src/services/exports.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  commitAll,
  createTempRoot,
  currentBranch,
  initializeGitProject,
  writeExportingCodex,
} from "./helpers/exports.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXPORT_GIT_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";
import { normalizeLineEndings } from "./helpers/platform.js";

describe("materialized exports", () => {
  it(
    "applies a git winner directly to the current working tree by default",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await writeFile(join(cwd, "remove.txt"), "remove me\n", "utf8");
      await commitAll(cwd, "initial project");
      const baseBranch = await currentBranch(cwd);
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await materializeExport({
        cwd,
        withReport: true,
      });

      expect(result.plan.mode).toBe("git-apply");
      expect(result.plan.materializationMode).toBe("working-tree");
      expect(result.plan.patchPath).toBe(getExportPatchPath(cwd, planned.id));
      expect(normalizeLineEndings(await readFile(join(cwd, "app.txt"), "utf8"))).toBe("patched\n");
      expect(normalizeLineEndings(await readFile(join(cwd, "added.txt"), "utf8"))).toBe(
        "new file\n",
      );
      await expect(readFile(join(cwd, "remove.txt"), "utf8")).rejects.toThrow();
      expect(await currentBranch(cwd)).toBe(baseBranch);

      const savedPlan = exportPlanSchema.parse(
        JSON.parse(await readFile(result.path, "utf8")) as unknown,
      );
      expect(savedPlan.winnerId).toBe("cand-01");

      const savedManifest = runManifestSchema.parse(
        JSON.parse(await readFile(getRunManifestPath(cwd, planned.id), "utf8")) as unknown,
      );
      expect(savedManifest.candidates[0]?.status).toBe("exported");

      await expect(
        materializeExport({
          cwd,
          withReport: true,
        }),
      ).rejects.toThrow(
        `Candidate "cand-01" is already exported for consultation "${planned.id}". Reopen the crowning record: .oraculum/runs/${planned.id}/reports/export-plan.json`,
      );
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "does not rematerialize exported candidates when the crowning record is missing",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        withReport: true,
      });
      await rm(getExportPlanPath(cwd, planned.id), { force: true });

      await expect(
        materializeExport({
          cwd,
          materializationName: "fix/session-loss-again",
          withReport: true,
          allowUnsafe: true,
        }),
      ).rejects.toThrow(
        `Candidate "cand-01" is already exported for consultation "${planned.id}", but the crowning record is missing at .oraculum/runs/${planned.id}/reports/export-plan.json.`,
      );
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "creates a git branch only when branch materialization is explicitly requested",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      expect(result.plan.mode).toBe("git-branch");
      expect(result.plan.materializationMode).toBe("branch");
      expect(result.plan.branchName).toBe("fix/session-loss");
      expect(await currentBranch(cwd)).toBe("fix/session-loss");
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "preserves file renames when generating a git branch export patch",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "old-name.txt"), "renamed\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

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
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 performs the rename cleanly."}',
      "utf8",
    );
  }
  process.exit(0);
}
fs.renameSync(path.join(process.cwd(), "old-name.txt"), path.join(process.cwd(), "new-name.txt"));
if (out) {
  fs.writeFileSync(out, "renamed file", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "rename old-name.txt to new-name.txt",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        branchName: "fix/rename-file",
        withReport: false,
      });

      await expect(readFile(join(cwd, "old-name.txt"), "utf8")).rejects.toThrow();
      await expect(readFile(join(cwd, "new-name.txt"), "utf8")).resolves.toBe("renamed\n");
      expect(await currentBranch(cwd)).toBe("fix/rename-file");
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "rejects git export when tracked local changes exist",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await writeFile(join(cwd, "app.txt"), "dirty local change\n", "utf8");

      await expect(
        materializeExport({
          cwd,
          withReport: false,
        }),
      ).rejects.toThrow("tracked local changes");
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "rejects git export when HEAD moved away from the candidate base revision",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await writeFile(join(cwd, "other.txt"), "next commit\n", "utf8");
      await commitAll(cwd, "move head");

      await expect(
        materializeExport({
          cwd,
          withReport: false,
        }),
      ).rejects.toThrow("recorded base revision");
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it("uses the latest consultation when crowning an explicitly selected survivor without a recommendation", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");

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
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      '{"decision":"abstain","confidence":"medium","summary":"Need a manual choice."}',
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched manually\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "fix session loss on refresh",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    const result = await materializeExport({
      cwd,
      winnerId: "cand-01",
      materializationName: "fix/manual-choice",
      withReport: false,
    });

    expect(result.plan.winnerId).toBe("cand-01");
    expect(result.plan.mode).toBe("workspace-sync");
    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched manually\n");
  });

  it(
    "ignores unmanaged runtime state files when exporting a git winner",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      await initializeProject({ cwd, force: false });

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
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 wins."}',
      "utf8",
    );
  }
  process.exit(0);
}
fs.mkdirSync(path.join(process.cwd(), ".omc", "state"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), ".omc", "state", "session.json"), '{"runtime":"state"}', "utf8");
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched\\n", "utf8");
if (out) fs.writeFileSync(out, "patched", "utf8");
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        withReport: false,
      });

      expect(normalizeLineEndings(await readFile(join(cwd, "app.txt"), "utf8"))).toBe("patched\n");
      await expect(lstat(join(cwd, ".omc"))).rejects.toThrow();
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "exports git candidates even when they commit inside the worktree",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      const baseBranch = await currentBranch(cwd);
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched from commit\\n", "utf8");
childProcess.execFileSync("git", ["add", "app.txt"], { cwd: process.cwd(), stdio: "ignore" });
childProcess.execFileSync("git", ["commit", "-m", "candidate commit"], { cwd: process.cwd(), stdio: "ignore" });
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await materializeExport({
        cwd,
        withReport: false,
      });

      expect(normalizeLineEndings(await readFile(join(cwd, "app.txt"), "utf8"))).toBe(
        "patched from commit\n",
      );
      expect(await currentBranch(cwd)).toBe(baseBranch);
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );

  it(
    "rolls back a real git export when bookkeeping fails on disk",
    async () => {
      const cwd = await createTempRoot();
      await initializeGitProject(cwd);
      await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await commitAll(cwd, "initial project");
      const baseBranch = await currentBranch(cwd);
      await initializeProject({ cwd, force: false });

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await planRun({
        cwd,
        taskInput: "fix session loss on refresh",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const candidateManifestPath = getCandidateManifestPath(cwd, planned.id, "cand-01");
      await rm(candidateManifestPath, { force: true });
      await mkdir(candidateManifestPath, { recursive: true });

      await expect(
        materializeExport({
          cwd,
          withReport: false,
        }),
      ).rejects.toThrow(
        "Crowning bookkeeping failed after applying changes and the crowning was rolled back",
      );

      expect(await currentBranch(cwd)).toBe(baseBranch);
      expect(normalizeLineEndings(await readFile(join(cwd, "app.txt"), "utf8"))).toBe("original\n");
      const savedManifest = runManifestSchema.parse(
        JSON.parse(await readFile(getRunManifestPath(cwd, planned.id), "utf8")) as unknown,
      );
      expect(savedManifest.candidates[0]?.status).toBe("promoted");
      const restoredCandidate = runManifestSchema.shape.candidates.element.parse(
        JSON.parse(await readFile(candidateManifestPath, "utf8")) as unknown,
      );
      expect(restoredCandidate.status).toBe("promoted");
    },
    EXPORT_GIT_TEST_TIMEOUT_MS,
  );
});
