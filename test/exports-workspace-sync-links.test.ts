import { lstat, mkdir, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { materializeExport } from "../src/services/exports.js";
import { readSymlinkTargetType as readManagedSymlinkTargetType } from "../src/services/managed-tree.js";
import { initializeProject } from "../src/services/project.js";
import { createTempRoot, forceWin32Semantics } from "./helpers/exports.js";
import { writeManualWorkspaceSyncWinner } from "./helpers/exports-workspace-sync.js";
import { EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS } from "./helpers/integration.js";
import { createDirectoryLink, normalizeLinkedPath } from "./helpers/platform.js";

describe("materialized exports", () => {
  it(
    "retargets absolute directory links during workspace-sync export under win32 semantics",
    async () => {
      const restorePlatform = forceWin32Semantics();
      try {
        const cwd = await createTempRoot();
        const runId = "run_manual";

        await initializeProject({ cwd, force: false });
        await mkdir(join(cwd, "target-dir"), { recursive: true });
        await writeFile(join(cwd, "target-dir", "file.txt"), "target\n", "utf8");
        await createDirectoryLink(join(cwd, "target-dir"), join(cwd, "linked-dir"));

        await writeManualWorkspaceSyncWinner({
          cwd,
          runId,
          workspaceSetup: async (workspaceDir) => {
            await mkdir(join(workspaceDir, "next-target"), { recursive: true });
            await writeFile(join(workspaceDir, "next-target", "file.txt"), "next\n", "utf8");
            await createDirectoryLink(
              join(workspaceDir, "next-target"),
              join(workspaceDir, "linked-dir"),
            );
          },
        });

        await materializeExport({
          cwd,
          runId,
          winnerId: "cand-01",
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

        await initializeProject({ cwd, force: false });
        await mkdir(join(cwd, "target-dir"), { recursive: true });
        await writeFile(join(cwd, "target-dir", "file.txt"), "target\n", "utf8");
        await createDirectoryLink(join(cwd, "target-dir"), join(cwd, "linked-dir"));

        await writeManualWorkspaceSyncWinner({
          cwd,
          runId,
          workspaceSetup: async (workspaceDir) => {
            await mkdir(join(workspaceDir, "next-target"), { recursive: true });
            await writeFile(join(workspaceDir, "next-target", "file.txt"), "next\n", "utf8");
            await createDirectoryLink(
              join(workspaceDir, "next-target"),
              join(workspaceDir, "linked-dir"),
            );
          },
        });

        await materializeExport({
          cwd,
          runId,
          winnerId: "cand-01",
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
});
