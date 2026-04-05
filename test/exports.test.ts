import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getExportPatchPath,
  getExportSyncSummaryPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { runSubprocess } from "../src/core/subprocess.js";
import { exportPlanSchema, runManifestSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { materializeExport } from "../src/services/exports.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("materialized exports", () => {
  it("creates a real git branch export from the recommended winner", async () => {
    const cwd = await createTempRoot();
    await initializeGitProject(cwd);
    await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await writeFile(join(cwd, "remove.txt"), "remove me\n", "utf8");
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
      timeoutMs: 5_000,
    });

    const result = await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: true,
    });

    expect(result.plan.mode).toBe("git-branch");
    expect(result.plan.patchPath).toBe(getExportPatchPath(cwd, planned.id));
    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
    expect(await readFile(join(cwd, "added.txt"), "utf8")).toBe("new file\n");
    await expect(readFile(join(cwd, "remove.txt"), "utf8")).rejects.toThrow();
    expect(await currentBranch(cwd)).toBe("fix/session-loss");

    const savedPlan = exportPlanSchema.parse(
      JSON.parse(await readFile(result.path, "utf8")) as unknown,
    );
    expect(savedPlan.winnerId).toBe("cand-01");

    const savedManifest = runManifestSchema.parse(
      JSON.parse(await readFile(getRunManifestPath(cwd, planned.id), "utf8")) as unknown,
    );
    expect(savedManifest.candidates[0]?.status).toBe("exported");
  });

  it("rejects git export when tracked local changes exist", async () => {
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
      timeoutMs: 5_000,
    });

    await writeFile(join(cwd, "app.txt"), "dirty local change\n", "utf8");

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("tracked local changes");
  });

  it("rejects git export when HEAD moved away from the candidate base revision", async () => {
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
      timeoutMs: 5_000,
    });

    await writeFile(join(cwd, "other.txt"), "next commit\n", "utf8");
    await commitAll(cwd, "move head");

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("recorded base revision");
  });

  it("exports git candidates even when they commit inside the worktree", async () => {
    const cwd = await createTempRoot();
    await initializeGitProject(cwd);
    await writeFile(join(cwd, ".gitignore"), ".oraculum/\n", "utf8");
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await commitAll(cwd, "initial project");
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
      timeoutMs: 5_000,
    });

    await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched from commit\n");
    expect(await currentBranch(cwd)).toBe("fix/session-loss");
  });

  it("syncs a non-git winner workspace back into the project folder", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await writeFile(join(cwd, "remove.txt"), "remove me\n", "utf8");

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
      timeoutMs: 5_000,
    });

    const result = await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(result.plan.mode).toBe("workspace-sync");
    expect(result.plan.appliedPathCount).toBe(2);
    expect(result.plan.removedPathCount).toBe(1);
    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
    expect(await readFile(join(cwd, "added.txt"), "utf8")).toBe("new file\n");
    await expect(readFile(join(cwd, "remove.txt"), "utf8")).rejects.toThrow();

    const syncSummary = JSON.parse(
      await readFile(getExportSyncSummaryPath(cwd, planned.id), "utf8"),
    ) as {
      appliedFiles: string[];
      removedFiles: string[];
    };
    expect(syncSummary.appliedFiles).toEqual(expect.arrayContaining(["added.txt", "app.txt"]));
    expect(syncSummary.removedFiles).toEqual(["remove.txt"]);
  });

  it("rejects workspace-sync export when the project changed after the run", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");

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
      timeoutMs: 5_000,
    });

    await writeFile(join(cwd, "app.txt"), "changed after run\n", "utf8");

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("managed project paths changed since the run started");
  });

  it("ignores nested excluded paths during workspace-sync export and snapshot checks", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await mkdir(join(cwd, "packages", "app", "dist"), { recursive: true });
    await mkdir(join(cwd, "packages", "app", "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", ".env.local"), "before\n", "utf8");
    await writeFile(join(cwd, "packages", "app", "dist", "bundle.js"), "before\n", "utf8");
    await writeFile(
      join(cwd, "packages", "app", "node_modules", "pkg", "index.js"),
      "before\n",
      "utf8",
    );

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
      timeoutMs: 5_000,
    });

    await writeFile(join(cwd, "packages", "app", ".env.local"), "changed after run\n", "utf8");
    await writeFile(
      join(cwd, "packages", "app", "dist", "bundle.js"),
      "changed after run\n",
      "utf8",
    );
    await writeFile(
      join(cwd, "packages", "app", "node_modules", "pkg", "index.js"),
      "changed after run\n",
      "utf8",
    );

    await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
    expect(await readFile(join(cwd, "packages", "app", ".env.local"), "utf8")).toBe(
      "changed after run\n",
    );
    expect(await readFile(join(cwd, "packages", "app", "dist", "bundle.js"), "utf8")).toBe(
      "changed after run\n",
    );
    expect(
      await readFile(join(cwd, "packages", "app", "node_modules", "pkg", "index.js"), "utf8"),
    ).toBe("changed after run\n");
  });

  it("preserves excluded nested content when a managed parent directory disappears", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "packages", "app", "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", "keep.txt"), "managed\n", "utf8");
    await writeFile(join(cwd, "packages", "app", ".env.local"), "secret\n", "utf8");
    await writeFile(
      join(cwd, "packages", "app", "node_modules", "pkg", "index.js"),
      "dep\n",
      "utf8",
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
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.rmSync(path.join(process.cwd(), "packages"), { recursive: true, force: true });
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "preserve unmanaged nested content",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    await expect(readFile(join(cwd, "packages", "app", "keep.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(join(cwd, "packages", "app", ".env.local"), "utf8")).toBe("secret\n");
    expect(
      await readFile(join(cwd, "packages", "app", "node_modules", "pkg", "index.js"), "utf8"),
    ).toBe("dep\n");
  });

  it("rolls back workspace-sync exports when a late path replacement fails", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", ".env.local"), "secret\n", "utf8");

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
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched before failure\\n", "utf8");
fs.rmSync(path.join(process.cwd(), "packages", "app"), { recursive: true, force: true });
fs.mkdirSync(path.join(process.cwd(), "packages"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "packages", "app"), "file replacement\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "rollback workspace sync",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    await expect(
      materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("still contains unmanaged files or directories");

    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(cwd, "packages", "app", ".env.local"), "utf8")).toBe("secret\n");
  });

  it("syncs empty directory changes during workspace-sync export", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await mkdir(join(cwd, "remove-empty"), { recursive: true });

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
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.rmSync(path.join(process.cwd(), "remove-empty"), { recursive: true, force: true });
fs.mkdirSync(path.join(process.cwd(), "created-empty"), { recursive: true });
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
    );

    const planned = await planRun({
      cwd,
      taskInput: "sync empty directories",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    await materializeExport({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    await expect(lstat(join(cwd, "created-empty"))).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(lstat(join(cwd, "remove-empty"))).rejects.toThrow();
    expect((await lstat(join(cwd, "created-empty"))).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "preserves executable mode changes during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "tool.sh"), "#!/bin/sh\necho ok\n", "utf8");
      await chmod(join(cwd, "tool.sh"), 0o644);

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
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.chmodSync(path.join(process.cwd(), "tool.sh"), 0o755);
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "preserve executable mode",
        agent: "codex",
        candidates: 1,
      });

      await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      });

      await materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      expect((await stat(join(cwd, "tool.sh"))).mode & 0o777).toBe(0o755);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves symlinks during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "target.txt"), "target\n", "utf8");
      await symlink("target.txt", join(cwd, "linked.txt"));

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
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
const linkedPath = path.join(process.cwd(), "linked.txt");
try {
  fs.rmSync(linkedPath, { force: true });
} catch {}
fs.symlinkSync("target.txt", linkedPath);
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
        timeoutMs: 5_000,
      });

      await materializeExport({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      });

      const linkedStats = await lstat(join(cwd, "linked.txt"));
      expect(linkedStats.isSymbolicLink()).toBe(true);
    },
  );
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}

async function writeExportingCodex(cwd: string): Promise<string> {
  return writeNodeBinary(
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
      JSON.stringify({
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched\\n", "utf8");
fs.writeFileSync(path.join(process.cwd(), "added.txt"), "new file\\n", "utf8");
const removePath = path.join(process.cwd(), "remove.txt");
if (fs.existsSync(removePath)) {
  fs.unlinkSync(removePath);
}
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
  );
}

async function initializeGitProject(cwd: string): Promise<void> {
  await runGit(cwd, ["init"]);
  await runGit(cwd, ["config", "user.name", "Oraculum Test"]);
  await runGit(cwd, ["config", "user.email", "oraculum@example.com"]);
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ["add", "-A"]);
  await runGit(cwd, ["commit", "-m", message]);
}

async function currentBranch(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["branch", "--show-current"]);
  return result.stdout.trim();
}

async function runGit(cwd: string, args: string[]) {
  const result = await runSubprocess({
    command: "git",
    args,
    cwd,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result;
}
