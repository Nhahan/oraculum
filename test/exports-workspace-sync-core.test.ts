import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getAdvancedConfigPath, getExportSyncSummaryPath } from "../src/core/paths.js";
import { materializeExport } from "../src/services/exports.js";
import { initializeProject, writeJsonFile } from "../src/services/project.js";
import { createTempRoot, writeExportingCodex } from "./helpers/exports.js";
import {
  runWorkspaceSyncConsultation,
  writeSelectingCodex,
} from "./helpers/exports-workspace-sync.js";
import { EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS } from "./helpers/integration.js";

describe("materialized exports", () => {
  it(
    "syncs a non-git winner workspace back into the project folder",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await writeFile(join(cwd, "remove.txt"), "remove me\n", "utf8");

      const fakeCodex = await writeExportingCodex(cwd);
      const planned = await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "fix session loss on refresh",
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

      const fakeCodex = await writeSelectingCodex(
        cwd,
        "fake-codex",
        `const binary = Buffer.alloc(256 * 1024, 0x02);
binary[0] = 0x00;
binary[1] = 0xff;
binary[binary.length - 1] = 0x7f;
fs.writeFileSync(path.join(process.cwd(), "asset.bin"), binary);`,
        "cand-01 updates binary content.",
      );

      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "update the binary asset",
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

      const fakeCodex = await writeSelectingCodex(
        cwd,
        "fake-codex",
        `fs.writeFileSync(path.join(process.cwd(), "dist", "index.js"), "patched dist\\n", "utf8");`,
        "cand-01 updates dist intentionally.",
      );

      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "update the checked-in dist bundle",
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
    "rejects workspace-sync export when the project changed after the run",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");

      const fakeCodex = await writeExportingCodex(cwd);
      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "fix session loss on refresh",
      });

      await writeFile(join(cwd, "app.txt"), "changed after run\n", "utf8");

      await expect(
        materializeExport({
          cwd,
          materializationName: "fix/session-loss",
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
      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "fix session loss on refresh",
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
        materializationName: "fix/session-loss",
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

  it(
    "preserves linked non-Node dependency and cache trees during workspace-sync export",
    async () => {
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
      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "patch app while preserving non-node dependency caches",
      });

      await writeFile(
        join(cwd, ".venv", process.platform === "win32" ? "Scripts" : "bin", "python"),
        "python changed after run\n",
        "utf8",
      );
      await writeFile(
        join(cwd, "target", "debug", "app"),
        "rust target changed after run\n",
        "utf8",
      );
      await writeFile(
        join(cwd, ".gradle", "caches", "state"),
        "gradle changed after run\n",
        "utf8",
      );

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
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  const nonWindowsSymlink = process.platform === "win32" ? it.skip : it;

  nonWindowsSymlink(
    "preserves project symlinks whose targets are unmanaged during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await writeFile(join(cwd, ".env"), "SECRET=1\n", "utf8");
      await symlink(".env", join(cwd, "linked-env"));

      const fakeCodex = await writeExportingCodex(cwd);
      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "patch app without exposing local secret links",
      });

      await materializeExport({
        cwd,
        withReport: false,
      });

      expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
      expect(await readlink(join(cwd, "linked-env"))).toBe(".env");
      expect(await readFile(join(cwd, ".env"), "utf8")).toBe("SECRET=1\n");
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "syncs empty directory changes during workspace-sync export",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await mkdir(join(cwd, "remove-empty"), { recursive: true });

      const fakeCodex = await writeSelectingCodex(
        cwd,
        "fake-codex",
        `fs.rmSync(path.join(process.cwd(), "remove-empty"), { recursive: true, force: true });
fs.mkdirSync(path.join(process.cwd(), "created-empty"), { recursive: true });`,
      );

      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "sync empty directories",
      });

      await materializeExport({
        cwd,
        materializationName: "fix/session-loss",
        withReport: false,
      });

      await expect(lstat(join(cwd, "created-empty"))).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(lstat(join(cwd, "remove-empty"))).rejects.toThrow();
      expect((await lstat(join(cwd, "created-empty"))).isDirectory()).toBe(true);
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );
});
