import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { materializeExport } from "../src/services/exports.js";
import { initializeProject } from "../src/services/project.js";
import { createTempRoot } from "./helpers/exports.js";
import {
  runWorkspaceSyncConsultation,
  writeSelectingCodex,
} from "./helpers/exports-workspace-sync.js";
import { EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS } from "./helpers/integration.js";

describe("materialized exports", () => {
  it(
    "preserves excluded nested content when a managed parent directory disappears",
    async () => {
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

      const fakeCodex = await writeSelectingCodex(
        cwd,
        "fake-codex",
        `fs.rmSync(path.join(process.cwd(), "packages"), { recursive: true, force: true });`,
      );

      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "preserve unmanaged nested content",
      });

      await materializeExport({
        cwd,
        materializationName: "fix/session-loss",
        withReport: false,
      });

      await expect(readFile(join(cwd, "packages", "app", "keep.txt"), "utf8")).rejects.toThrow();
      expect(await readFile(join(cwd, "packages", "app", ".env.local"), "utf8")).toBe("secret\n");
      expect(
        await readFile(join(cwd, "packages", "app", "node_modules", "pkg", "index.js"), "utf8"),
      ).toBe("dep\n");
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "rolls back workspace-sync exports when a late path replacement fails",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
      await mkdir(join(cwd, "packages", "app"), { recursive: true });
      await writeFile(join(cwd, "packages", "app", ".env.local"), "secret\n", "utf8");

      const fakeCodex = await writeSelectingCodex(
        cwd,
        "fake-codex",
        `fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched before failure\\n", "utf8");
fs.rmSync(path.join(process.cwd(), "packages", "app"), { recursive: true, force: true });
fs.mkdirSync(path.join(process.cwd(), "packages"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "packages", "app"), "file replacement\\n", "utf8");`,
      );

      await runWorkspaceSyncConsultation({
        cwd,
        codexBinaryPath: fakeCodex,
        taskInput: "rollback workspace sync",
      });

      await expect(
        materializeExport({
          cwd,
          materializationName: "fix/session-loss",
          withReport: false,
        }),
      ).rejects.toThrow("still contains unmanaged files or directories");

      expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("original\n");
      expect(await readFile(join(cwd, "packages", "app", ".env.local"), "utf8")).toBe("secret\n");
    },
    EXPORT_WORKSPACE_SYNC_TEST_TIMEOUT_MS,
  );
});
