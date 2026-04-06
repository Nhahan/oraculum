import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyManagedProjectTree, readSymlinkTargetType } from "../src/services/managed-tree.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("managed tree symlink semantics", () => {
  it("preserves relative directory symlinks as dir links under win32 semantics", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "target-dir"), { recursive: true });
    await writeFile(join(root, "target-dir", "file.txt"), "target\n", "utf8");
    await createDirectoryLink("target-dir", join(root, "linked-dir"));

    const restorePlatform = forceWin32Semantics();
    try {
      expect(await readSymlinkTargetType(join(root, "linked-dir"))).toBe("dir");
    } finally {
      restorePlatform();
    }
  });

  it("treats absolute directory links as junctions and retargets them to the destination tree", async () => {
    const sourceRoot = await createTempRoot();
    const destinationRoot = await createTempRoot();
    await mkdir(join(sourceRoot, "target-dir"), { recursive: true });
    await writeFile(join(sourceRoot, "target-dir", "file.txt"), "target\n", "utf8");
    await createDirectoryLink(join(sourceRoot, "target-dir"), join(sourceRoot, "linked-dir"));

    const restorePlatform = forceWin32Semantics();
    try {
      await copyManagedProjectTree(sourceRoot, destinationRoot);

      const linkedPath = join(destinationRoot, "linked-dir");
      expect((await lstat(linkedPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkedPath)).toBe(join(destinationRoot, "target-dir"));
      expect(await readSymlinkTargetType(linkedPath)).toBe("junction");
    } finally {
      restorePlatform();
    }
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function overridePlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  return () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: original,
    });
  };
}

function forceWin32Semantics(): () => void {
  return process.platform === "win32" ? () => {} : overridePlatform("win32");
}
