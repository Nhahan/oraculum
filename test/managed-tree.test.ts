import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyManagedProjectTree,
  readSymlinkTargetType,
  shouldLinkProjectDependencyTree,
  shouldManageProjectPath,
} from "../src/services/managed-tree.js";
import { createDirectoryLink, normalizeLinkedPath } from "./helpers/platform.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("managed tree symlink semantics", () => {
  it("allows explicit management of ambiguous generated directories without overriding protected paths", async () => {
    const sourceRoot = await createTempRoot();
    const destinationRoot = await createTempRoot();
    await mkdir(join(sourceRoot, "dist"), { recursive: true });
    await writeFile(join(sourceRoot, "dist", "index.js"), "dist source\n", "utf8");
    await writeFile(join(sourceRoot, ".env"), "SECRET=1\n", "utf8");

    await copyManagedProjectTree(sourceRoot, destinationRoot, {
      rules: {
        includePaths: ["dist"],
        excludePaths: [],
      },
    });

    expect(
      shouldManageProjectPath("dist/index.js", { includePaths: ["dist"], excludePaths: [] }),
    ).toBe(true);
    expect(
      shouldManageProjectPath("dist/node_modules/pkg/index.js", {
        includePaths: ["dist"],
        excludePaths: [],
      }),
    ).toBe(false);
    expect(shouldManageProjectPath(".env", { includePaths: [".env"], excludePaths: [] })).toBe(
      false,
    );
    await expect(readFile(join(destinationRoot, "dist", "index.js"), "utf8")).resolves.toBe(
      "dist source\n",
    );
    await expect(lstat(join(destinationRoot, ".env"))).rejects.toThrow();
  });

  it("allows explicit exclusion of ambiguous source-shaped directories", async () => {
    const sourceRoot = await createTempRoot();
    const destinationRoot = await createTempRoot();
    await mkdir(join(sourceRoot, "build"), { recursive: true });
    await writeFile(join(sourceRoot, "build", "artifact.txt"), "artifact\n", "utf8");

    await copyManagedProjectTree(sourceRoot, destinationRoot, {
      rules: {
        includePaths: [],
        excludePaths: ["build"],
      },
    });

    expect(
      shouldManageProjectPath("build/artifact.txt", { includePaths: [], excludePaths: ["build"] }),
    ).toBe(false);
    await expect(lstat(join(destinationRoot, "build"))).rejects.toThrow();
  });

  it("links only unmanaged dependency trees and respects explicit managed includes", () => {
    const rules = {
      includePaths: ["target/docs"],
      excludePaths: [],
    };

    expect(shouldLinkProjectDependencyTree("node_modules", rules)).toBe(true);
    expect(shouldLinkProjectDependencyTree(".venv", rules)).toBe(true);
    expect(shouldLinkProjectDependencyTree(".gradle", rules)).toBe(true);
    expect(shouldLinkProjectDependencyTree("target", rules)).toBe(false);
    expect(shouldLinkProjectDependencyTree("target/docs", rules)).toBe(false);
    expect(shouldLinkProjectDependencyTree("target/debug", rules)).toBe(true);
    expect(shouldLinkProjectDependencyTree(".env", rules)).toBe(false);
  });

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
      expect(normalizeLinkedPath(await readlink(linkedPath))).toBe(
        normalizeLinkedPath(join(destinationRoot, "target-dir")),
      );
      expect(await readSymlinkTargetType(linkedPath)).toBe("junction");
    } finally {
      restorePlatform();
    }
  });

  const nonWindowsFileSymlink = process.platform === "win32" ? it.skip : it;

  nonWindowsFileSymlink(
    "retargets absolute file symlinks that point inside the copied tree",
    async () => {
      const sourceRoot = await createTempRoot();
      const destinationRoot = await createTempRoot();
      await writeFile(join(sourceRoot, "target.txt"), "target\n", "utf8");
      await symlink(join(sourceRoot, "target.txt"), join(sourceRoot, "linked.txt"));

      await copyManagedProjectTree(sourceRoot, destinationRoot);

      expect(await readlink(join(destinationRoot, "linked.txt"))).toBe(
        join(destinationRoot, "target.txt"),
      );
    },
  );

  nonWindowsFileSymlink(
    "preserves absolute file symlinks that point into unmanaged subtrees",
    async () => {
      const sourceRoot = await createTempRoot();
      const destinationRoot = await createTempRoot();
      await mkdir(join(sourceRoot, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(sourceRoot, "node_modules", "pkg", "index.js"), "module\n", "utf8");
      await symlink(
        join(sourceRoot, "node_modules", "pkg", "index.js"),
        join(sourceRoot, "linked.txt"),
      );

      await copyManagedProjectTree(sourceRoot, destinationRoot);

      expect(await readlink(join(destinationRoot, "linked.txt"))).toBe(
        join(sourceRoot, "node_modules", "pkg", "index.js"),
      );
    },
  );
});

const nativeWindowsDescribe = process.platform === "win32" ? describe : describe.skip;

nativeWindowsDescribe("managed tree native Windows reparse-point semantics", () => {
  it("preserves relative directory symlinks as dir links", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "target-dir"), { recursive: true });
    await writeFile(join(root, "target-dir", "file.txt"), "target\n", "utf8");
    await createDirectoryLink("target-dir", join(root, "linked-dir"));

    expect(await readSymlinkTargetType(join(root, "linked-dir"))).toBe("dir");
  });

  it("retargets absolute directory junctions to the destination tree", async () => {
    const sourceRoot = await createTempRoot();
    const destinationRoot = await createTempRoot();
    await mkdir(join(sourceRoot, "target-dir"), { recursive: true });
    await writeFile(join(sourceRoot, "target-dir", "file.txt"), "target\n", "utf8");
    await createDirectoryLink(join(sourceRoot, "target-dir"), join(sourceRoot, "linked-dir"));

    await copyManagedProjectTree(sourceRoot, destinationRoot);

    const linkedPath = join(destinationRoot, "linked-dir");
    expect((await lstat(linkedPath)).isSymbolicLink()).toBe(true);
    expect(normalizeLinkedPath(await readlink(linkedPath))).toBe(
      normalizeLinkedPath(join(destinationRoot, "target-dir")),
    );
    expect(await readSymlinkTargetType(linkedPath)).toBe("junction");
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
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
