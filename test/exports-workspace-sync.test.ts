import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAdvancedConfigPath,
  getCandidateDir,
  getCandidateManifestPath,
  getExportSyncSummaryPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { candidateManifestSchema, runManifestSchema } from "../src/domain/run.js";
import { captureManagedProjectSnapshot } from "../src/services/base-snapshots.js";
import { executeRun } from "../src/services/execution.js";
import { materializeExport } from "../src/services/exports.js";
import { readSymlinkTargetType as readManagedSymlinkTargetType } from "../src/services/managed-tree.js";
import { initializeProject, writeJsonFile } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { createTempRoot, forceWin32Semantics, writeExportingCodex } from "./helpers/exports.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import {
  EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  FAKE_AGENT_TIMEOUT_MS,
} from "./helpers/integration.js";
import { createDirectoryLink, normalizeLinkedPath } from "./helpers/platform.js";

describe("materialized exports", () => {
  it(
    "syncs a non-git winner workspace back into the project folder",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await materializeExport({
        cwd,
        withReport: false,
      });

      expect(result.plan.mode).toBe("workspace-sync");
      expect(result.plan.branchName).toBeUndefined();
      expect(result.plan.materializationLabel).toBeUndefined();
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
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "syncs binary files during non-git workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "asset.bin"), Buffer.alloc(256 * 1024, 0x01));

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
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 updates binary content."}',
      "utf8",
    );
  }
  process.exit(0);
}
const binary = Buffer.alloc(256 * 1024, 0x02);
binary[0] = 0x00;
binary[1] = 0xff;
binary[binary.length - 1] = 0x7f;
fs.writeFileSync(path.join(process.cwd(), "asset.bin"), binary);
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );
      const planned = await planRun({
        cwd,
        taskInput: "update the binary asset",
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
        withReport: false,
      });

      const binary = await readFile(join(cwd, "asset.bin"));
      expect(result.plan.mode).toBe("workspace-sync");
      expect(result.plan.appliedPathCount).toBe(1);
      expect(binary).toHaveLength(256 * 1024);
      expect(binary[0]).toBe(0x00);
      expect(binary[1]).toBe(0xff);
      expect(binary[binary.length - 1]).toBe(0x7f);
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "syncs explicitly included ambiguous dist paths in non-git workspace mode",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeJsonFile(getAdvancedConfigPath(cwd), {
        version: 1,
        managedTree: {
          includePaths: ["dist"],
          excludePaths: [],
        },
      });
      await mkdir(join(cwd, "dist"), { recursive: true });
      await writeFile(join(cwd, "dist", "index.js"), "original dist\n", "utf8");

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
      '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 updates dist intentionally."}',
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "dist", "index.js"), "patched dist\\n", "utf8");
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "update the checked-in dist bundle",
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
        withReport: false,
      });

      expect(result.plan.mode).toBe("workspace-sync");
      expect(result.plan.appliedPathCount).toBe(1);
      expect(await readFile(join(cwd, "dist", "index.js"), "utf8")).toBe("patched dist\n");
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "retargets absolute directory links during workspace-sync export under win32 semantics",
    async () => {
      const restorePlatform = forceWin32Semantics();
      try {
        const cwd = await createTempRoot();
        const runId = "run_manual";
        const candidateId = "cand-01";
        const candidateDir = getCandidateDir(cwd, runId, candidateId);
        const workspaceDir = join(cwd, ".oraculum", "workspaces", runId, candidateId);
        const baseSnapshotPath = join(candidateDir, "base-snapshot.json");

        await initializeProject({ cwd, force: false });
        await mkdir(join(cwd, "target-dir"), { recursive: true });
        await writeFile(join(cwd, "target-dir", "file.txt"), "target\n", "utf8");
        await createDirectoryLink(join(cwd, "target-dir"), join(cwd, "linked-dir"));

        await mkdir(candidateDir, { recursive: true });
        await writeJsonFile(baseSnapshotPath, await captureManagedProjectSnapshot(cwd));
        await mkdir(workspaceDir, { recursive: true });
        await mkdir(join(workspaceDir, "next-target"), { recursive: true });
        await writeFile(join(workspaceDir, "next-target", "file.txt"), "next\n", "utf8");
        await createDirectoryLink(
          join(workspaceDir, "next-target"),
          join(workspaceDir, "linked-dir"),
        );

        const candidate = candidateManifestSchema.parse({
          id: candidateId,
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir,
          taskPacketPath: join(candidateDir, "task-packet.json"),
          workspaceMode: "copy",
          baseSnapshotPath,
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        });
        await writeJsonFile(getCandidateManifestPath(cwd, runId, candidateId), candidate);
        await writeJsonFile(
          getRunManifestPath(cwd, runId),
          runManifestSchema.parse({
            id: runId,
            status: "completed",
            taskPath: join(cwd, "tasks", "task.md"),
            taskPacket: {
              id: "task_1",
              title: "Task",
              sourceKind: "task-note",
              sourcePath: join(cwd, "tasks", "task.md"),
            },
            agent: "codex",
            candidateCount: 1,
            createdAt: "2026-04-06T00:00:00.000Z",
            rounds: [
              {
                id: "fast",
                label: "Fast",
                status: "completed",
                verdictCount: 1,
                survivorCount: 1,
                eliminatedCount: 0,
              },
            ],
            recommendedWinner: {
              candidateId,
              confidence: "high",
              summary: "cand-01 is the recommended winner.",
              source: "llm-judge",
            },
            outcome: {
              type: "recommended-survivor",
              terminal: true,
              crownable: true,
              finalistCount: 1,
              recommendedCandidateId: candidateId,
              validationPosture: "sufficient",
              verificationLevel: "lightweight",
              validationGapCount: 0,
              judgingBasisKind: "unknown",
            },
            candidates: [candidate],
          }),
        );

        await materializeExport({
          cwd,
          runId,
          winnerId: candidateId,
          branchName: "fix/session-loss",
          withReport: false,
        });

        const linkedPath = join(cwd, "linked-dir");
        expect((await lstat(linkedPath)).isSymbolicLink()).toBe(true);
        expect(normalizeLinkedPath(await readlink(linkedPath))).toBe(
          normalizeLinkedPath(join(cwd, "next-target")),
        );
        expect(await readManagedSymlinkTargetType(linkedPath)).toBe("junction");
      } finally {
        restorePlatform();
      }
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  const nativeWindowsDescribe = process.platform === "win32" ? describe : describe.skip;

  nativeWindowsDescribe(
    "native Windows reparse-point exports",
    () => {
      it("retargets absolute directory links during workspace-sync export", async () => {
        const cwd = await createTempRoot();
        const runId = "run_native_win32";
        const candidateId = "cand-01";
        const candidateDir = getCandidateDir(cwd, runId, candidateId);
        const workspaceDir = join(cwd, ".oraculum", "workspaces", runId, candidateId);
        const baseSnapshotPath = join(candidateDir, "base-snapshot.json");

        await initializeProject({ cwd, force: false });
        await mkdir(join(cwd, "target-dir"), { recursive: true });
        await writeFile(join(cwd, "target-dir", "file.txt"), "target\n", "utf8");
        await createDirectoryLink(join(cwd, "target-dir"), join(cwd, "linked-dir"));

        await mkdir(candidateDir, { recursive: true });
        await writeJsonFile(baseSnapshotPath, await captureManagedProjectSnapshot(cwd));
        await mkdir(workspaceDir, { recursive: true });
        await mkdir(join(workspaceDir, "next-target"), { recursive: true });
        await writeFile(join(workspaceDir, "next-target", "file.txt"), "next\n", "utf8");
        await createDirectoryLink(
          join(workspaceDir, "next-target"),
          join(workspaceDir, "linked-dir"),
        );

        const candidate = candidateManifestSchema.parse({
          id: candidateId,
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir,
          taskPacketPath: join(candidateDir, "task-packet.json"),
          workspaceMode: "copy",
          baseSnapshotPath,
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        });
        await writeJsonFile(getCandidateManifestPath(cwd, runId, candidateId), candidate);
        await writeJsonFile(
          getRunManifestPath(cwd, runId),
          runManifestSchema.parse({
            id: runId,
            status: "completed",
            taskPath: join(cwd, "tasks", "task.md"),
            taskPacket: {
              id: "task_1",
              title: "Task",
              sourceKind: "task-note",
              sourcePath: join(cwd, "tasks", "task.md"),
            },
            agent: "codex",
            candidateCount: 1,
            createdAt: "2026-04-06T00:00:00.000Z",
            rounds: [
              {
                id: "fast",
                label: "Fast",
                status: "completed",
                verdictCount: 1,
                survivorCount: 1,
                eliminatedCount: 0,
              },
            ],
            recommendedWinner: {
              candidateId,
              confidence: "high",
              summary: "cand-01 is the recommended winner.",
              source: "llm-judge",
            },
            candidates: [candidate],
          }),
        );

        await materializeExport({
          cwd,
          runId,
          winnerId: candidateId,
          branchName: "fix/session-loss",
          withReport: false,
        });

        const linkedPath = join(cwd, "linked-dir");
        expect((await lstat(linkedPath)).isSymbolicLink()).toBe(true);
        expect(normalizeLinkedPath(await readlink(linkedPath))).toBe(
          normalizeLinkedPath(join(cwd, "next-target")),
        );
        expect(await readManagedSymlinkTargetType(linkedPath)).toBe("junction");
      });
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "rejects workspace-sync export when the project changed after the run",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await writeFile(join(cwd, "app.txt"), "changed after run\n", "utf8");

      await expect(
        materializeExport({
          cwd,
          branchName: "fix/session-loss",
          withReport: false,
        }),
      ).rejects.toThrow("managed project paths changed since the run started");
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "ignores nested excluded paths during workspace-sync export and snapshot checks",
    async () => {
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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it("preserves linked non-Node dependency and cache trees during workspace-sync export", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
    await mkdir(join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python"),
      "python before\n",
      "utf8",
    );
    await mkdir(join(cwd, "target", "debug"), { recursive: true });
    await writeFile(join(cwd, "target", "debug", "app"), "rust target before\n", "utf8");
    await mkdir(join(cwd, ".gradle", "caches"), { recursive: true });
    await writeFile(join(cwd, ".gradle", "caches", "state"), "gradle before\n", "utf8");

    const fakeCodex = await writeExportingCodex(cwd);
    const planned = await planRun({
      cwd,
      taskInput: "patch app while preserving non-node dependency caches",
      agent: "codex",
      candidates: 1,
    });

    await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
    });

    await writeFile(
      join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python"),
      "python changed after run\n",
      "utf8",
    );
    await writeFile(join(cwd, "target", "debug", "app"), "rust target changed after run\n", "utf8");
    await writeFile(join(cwd, ".gradle", "caches", "state"), "gradle changed after run\n", "utf8");

    await materializeExport({
      cwd,
      withReport: false,
    });

    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
    expect(
      await readFile(
        join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python"),
        "utf8",
      ),
    ).toBe("python changed after run\n");
    expect(await readFile(join(cwd, "target", "debug", "app"), "utf8")).toBe(
      "rust target changed after run\n",
    );
    expect(await readFile(join(cwd, ".gradle", "caches", "state"), "utf8")).toBe(
      "gradle changed after run\n",
    );
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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
      timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
});
