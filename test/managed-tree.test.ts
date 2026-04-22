import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  copyManagedProjectTree,
  readSymlinkTargetType,
  shouldLinkProjectDependencyTree,
  shouldManageProjectPath,
} from "../src/services/managed-tree.js";
import { createTempRootHarness } from "./helpers/fs.js";
import { createDirectoryLink, normalizeLinkedPath } from "./helpers/platform.js";

const tempRootHarness = createTempRootHarness("oraculum-");
tempRootHarness.registerCleanup();

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

  it("keeps local state unmanaged while allowing explicit source-like overrides", () => {
    const rules = {
      includePaths: [".idea/codeStyles", ".terraform/modules", ".serverless/manifest.json"],
      excludePaths: [],
    };

    expect(shouldManageProjectPath(".idea/workspace.xml")).toBe(false);
    expect(shouldManageProjectPath(".terraform/providers/registry/example")).toBe(false);
    expect(shouldManageProjectPath(".serverless/build.zip")).toBe(false);
    expect(shouldManageProjectPath(".pulumi/stacks/dev.json")).toBe(false);
    expect(shouldManageProjectPath(".vscode/settings.json")).toBe(true);
    expect(shouldManageProjectPath(".devcontainer/devcontainer.json")).toBe(true);

    expect(shouldManageProjectPath(".idea/codeStyles/Project.xml", rules)).toBe(true);
    expect(shouldManageProjectPath(".terraform/modules/module.json", rules)).toBe(true);
    expect(shouldManageProjectPath(".serverless/manifest.json", rules)).toBe(true);
  });

  it("keeps precise cloud credential paths protected without excluding whole source trees", () => {
    const rules = {
      includePaths: [".azure", ".config/gcloud", ".docker", ".config/gcloud/legacy_credentials"],
      excludePaths: [],
    };

    expect(shouldManageProjectPath(".docker/Dockerfile", rules)).toBe(true);
    expect(shouldManageProjectPath(".docker/config.json", rules)).toBe(false);
    expect(shouldManageProjectPath(".azure/templates/main.bicep", rules)).toBe(true);
    expect(shouldManageProjectPath(".azure/accessTokens.json", rules)).toBe(false);
    expect(shouldManageProjectPath(".config/gcloud/project.yaml", rules)).toBe(true);
    expect(
      shouldManageProjectPath(".config/gcloud/application_default_credentials.json", rules),
    ).toBe(false);
    expect(
      shouldManageProjectPath(".config/gcloud/legacy_credentials/user@example.com/adc.json", rules),
    ).toBe(false);
  });

  it("rejects unsafe relative and absolute managed-tree paths", () => {
    const rules = {
      includePaths: ["../secrets", "/tmp/generated", "C:\\temp\\generated"],
      excludePaths: [],
    };

    expect(shouldManageProjectPath("../secrets/token.txt")).toBe(false);
    expect(shouldManageProjectPath("src/../secrets/token.txt")).toBe(false);
    expect(shouldManageProjectPath("/tmp/generated/file.txt", rules)).toBe(false);
    expect(shouldManageProjectPath("C:\\temp\\generated\\file.txt", rules)).toBe(false);
    expect(shouldManageProjectPath("src\0secret.txt")).toBe(false);
    expect(shouldManageProjectPath("src/index.ts", rules)).toBe(true);
    expect(shouldLinkProjectDependencyTree("../node_modules/pkg")).toBe(false);
    expect(shouldLinkProjectDependencyTree("/tmp/node_modules/pkg")).toBe(false);
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
    "omits symlinks that would expose unmanaged or external paths",
    async () => {
      const sourceRoot = await createTempRoot();
      const destinationRoot = await createTempRoot();
      const externalRoot = await createTempRoot();
      await mkdir(join(sourceRoot, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(sourceRoot, "node_modules", "pkg", "index.js"), "module\n", "utf8");
      await writeFile(join(sourceRoot, ".env"), "SECRET=1\n", "utf8");
      await writeFile(join(externalRoot, "secret.txt"), "external\n", "utf8");
      await symlink(
        join(sourceRoot, "node_modules", "pkg", "index.js"),
        join(sourceRoot, "linked-module.txt"),
      );
      await symlink(join(sourceRoot, ".env"), join(sourceRoot, "linked-env.txt"));
      await symlink(join(externalRoot, "secret.txt"), join(sourceRoot, "linked-external.txt"));
      await mkdir(join(sourceRoot, "src"), { recursive: true });
      await symlink("../.env", join(sourceRoot, "src", "relative-env.txt"));

      await copyManagedProjectTree(sourceRoot, destinationRoot);

      await expect(lstat(join(destinationRoot, "linked-module.txt"))).rejects.toThrow();
      await expect(lstat(join(destinationRoot, "linked-env.txt"))).rejects.toThrow();
      await expect(lstat(join(destinationRoot, "linked-external.txt"))).rejects.toThrow();
      await expect(lstat(join(destinationRoot, "src", "relative-env.txt"))).rejects.toThrow();
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
  return tempRootHarness.createTempRoot();
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
