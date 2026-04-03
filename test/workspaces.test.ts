import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-workspaces-"));
  tempRoots.push(path);
  return path;
}
