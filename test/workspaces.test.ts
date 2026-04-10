import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareCandidateWorkspace } from "../src/services/workspaces.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("candidate workspace preparation", () => {
  it("copies the project tree when the root is not a git repository", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");
    await writeFile(join(projectRoot, ".oraculum-note"), "keep\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(projectRoot, ".gitignore"), ".oraculum\n", "utf8");

    const prepared = await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    expect(prepared.mode).toBe("copy");
    await expect(readFile(join(workspaceDir, "README.md"), "utf8")).resolves.toContain("hello");
  });

  it("does not copy sensitive top-level files into copied workspaces", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");
    await writeFile(join(projectRoot, ".env"), "SECRET=1\n", "utf8");
    await writeFile(join(projectRoot, ".npmrc"), "//registry.example/\n", "utf8");
    await mkdir(join(projectRoot, ".aws"), { recursive: true });
    await writeFile(join(projectRoot, ".aws", "credentials"), "token\n", "utf8");

    await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    await expect(readFile(join(workspaceDir, "README.md"), "utf8")).resolves.toContain("hello");
    await expect(stat(join(workspaceDir, ".env"))).rejects.toThrow();
    await expect(stat(join(workspaceDir, ".npmrc"))).rejects.toThrow();
    await expect(stat(join(workspaceDir, ".aws"))).rejects.toThrow();
  });

  it("links common unmanaged dependency and cache trees into copied workspaces", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");
    await mkdir(join(projectRoot, ".venv", "lib"), { recursive: true });
    await writeFile(join(projectRoot, ".venv", "lib", "python"), "python\n", "utf8");
    await mkdir(join(projectRoot, "__pycache__"), { recursive: true });
    await writeFile(join(projectRoot, "__pycache__", "module.pyc"), "cache\n", "utf8");
    await mkdir(join(projectRoot, "target", "debug"), { recursive: true });
    await writeFile(join(projectRoot, "target", "debug", "binary"), "binary\n", "utf8");
    await mkdir(join(projectRoot, ".gradle", "caches"), { recursive: true });
    await writeFile(join(projectRoot, ".gradle", "caches", "state"), "cache\n", "utf8");

    await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    await writeFile(join(projectRoot, ".venv", "lib", "python"), "python updated\n", "utf8");
    await writeFile(join(projectRoot, "target", "debug", "binary"), "binary updated\n", "utf8");
    await writeFile(join(projectRoot, ".gradle", "caches", "state"), "cache updated\n", "utf8");

    await expect(readFile(join(workspaceDir, "README.md"), "utf8")).resolves.toContain("hello");
    await expect(readFile(join(workspaceDir, ".venv", "lib", "python"), "utf8")).resolves.toBe(
      "python updated\n",
    );
    await expect(stat(join(workspaceDir, "__pycache__"))).rejects.toThrow();
    await expect(readFile(join(workspaceDir, "target", "debug", "binary"), "utf8")).resolves.toBe(
      "binary updated\n",
    );
    await expect(readFile(join(workspaceDir, ".gradle", "caches", "state"), "utf8")).resolves.toBe(
      "cache updated\n",
    );
  });

  it("copies explicitly included ambiguous directories into copied workspaces", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    await mkdir(join(projectRoot, "dist"), { recursive: true });
    await writeFile(join(projectRoot, "dist", "index.js"), "dist source\n", "utf8");
    await mkdir(join(projectRoot, "target", "docs"), { recursive: true });
    await writeFile(join(projectRoot, "target", "docs", "index.html"), "docs\n", "utf8");

    await prepareCandidateWorkspace({
      managedTreeRules: {
        includePaths: ["dist", "target/docs"],
        excludePaths: [],
      },
      projectRoot,
      workspaceDir,
    });

    await expect(readFile(join(workspaceDir, "dist", "index.js"), "utf8")).resolves.toBe(
      "dist source\n",
    );
    await expect(
      readFile(join(workspaceDir, "target", "docs", "index.html"), "utf8"),
    ).resolves.toBe("docs\n");
  });

  it("links node_modules dependency trees into copied workspaces", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    await mkdir(join(projectRoot, "node_modules", "tool"), { recursive: true });
    await writeFile(join(projectRoot, "node_modules", "tool", "index.js"), "module.exports = 1;\n");
    await mkdir(join(projectRoot, "packages", "app", "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(projectRoot, "packages", "app", "node_modules", "pkg", "index.js"),
      "export const value = 1;\n",
      "utf8",
    );

    await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    await expect(
      readFile(join(workspaceDir, "node_modules", "tool", "index.js"), "utf8"),
    ).resolves.toContain("module.exports = 1");
    await expect(
      readFile(join(workspaceDir, "packages", "app", "node_modules", "pkg", "index.js"), "utf8"),
    ).resolves.toContain("export const value = 1");
  });

  it("creates a git worktree when the root is a git repository", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: projectRoot });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: projectRoot });

    const prepared = await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    expect(prepared.mode).toBe("git-worktree");
    await expect(readFile(join(workspaceDir, "README.md"), "utf8")).resolves.toContain("hello");
  });

  it("resets an existing git worktree before reusing it", async () => {
    const projectRoot = await createTempRoot();
    const workspaceDir = join(projectRoot, ".oraculum", "workspaces", "run_1", "cand-01");

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: projectRoot });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: projectRoot });

    await prepareCandidateWorkspace({ projectRoot, workspaceDir });
    await writeFile(join(workspaceDir, "README.md"), "modified\n", "utf8");
    await writeFile(join(workspaceDir, "scratch.txt"), "temp\n", "utf8");

    const prepared = await prepareCandidateWorkspace({ projectRoot, workspaceDir });

    expect(prepared.mode).toBe("git-worktree");
    await expect(readFile(join(workspaceDir, "README.md"), "utf8")).resolves.toContain("hello");
    await expect(stat(join(workspaceDir, "scratch.txt"))).rejects.toThrow();
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-workspaces-"));
  tempRoots.push(path);
  return path;
}
