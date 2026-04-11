import { describe, expect, it } from "vitest";

import {
  collectOracleLocalToolPaths,
  listRelativeLocalToolDirs,
  resolveRepoLocalWrapperCommand,
} from "../src/services/oracle-local-tools.js";

describe("oracle local tools", () => {
  it("lists platform-specific local tool directories in candidate-first order", () => {
    const existing = new Set([
      "/repo/.oraculum/workspaces/run-1/cand-01/node_modules/.bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/.venv/bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/venv/bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/bin",
      "/repo/node_modules/.bin",
      "/repo/.venv/bin",
      "/repo/venv/bin",
      "/repo/bin",
    ]);

    const paths = collectOracleLocalToolPaths({
      exists: (path) => existing.has(path),
      platform: "linux",
      projectRoot: "/repo",
      workspaceDir: "/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(paths).toEqual([
      "/repo/.oraculum/workspaces/run-1/cand-01/node_modules/.bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/.venv/bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/venv/bin",
      "/repo/.oraculum/workspaces/run-1/cand-01/bin",
      "/repo/node_modules/.bin",
      "/repo/.venv/bin",
      "/repo/venv/bin",
      "/repo/bin",
    ]);
  });

  it("uses Windows-specific executable directories", () => {
    expect(listRelativeLocalToolDirs("win32")).toEqual([
      "node_modules/.bin",
      ".venv/Scripts",
      "venv/Scripts",
      "bin",
    ]);
  });

  it("resolves workspace-local Gradle wrappers before project-root fallbacks", () => {
    const existing = new Set(["/repo/.oraculum/workspaces/run-1/cand-01/gradlew"]);

    const resolved = resolveRepoLocalWrapperCommand({
      command: "gradlew",
      exists: (path) => existing.has(path),
      platform: "linux",
      projectRoot: "/repo",
      scopeRoot: "/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(resolved).toEqual({
      resolvedCommand: "/repo/.oraculum/workspaces/run-1/cand-01/gradlew",
      resolution: "workspace-wrapper",
    });
  });

  it("resolves Windows Maven wrapper suffixes from the project root", () => {
    const existing = new Set(["C:/repo/mvnw.cmd"]);

    const resolved = resolveRepoLocalWrapperCommand({
      command: "mvnw",
      exists: (path) => existing.has(path),
      platform: "win32",
      projectRoot: "C:/repo",
      scopeRoot: "C:/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(resolved).toEqual({
      resolvedCommand: "C:/repo/mvnw.cmd",
      resolution: "project-wrapper",
    });
  });

  it("does not rewrite explicit paths or unrelated commands", () => {
    const existing = new Set<string>();

    expect(
      resolveRepoLocalWrapperCommand({
        command: "./gradlew",
        exists: (path) => existing.has(path),
        platform: "linux",
        projectRoot: "/repo",
        scopeRoot: "/repo/.oraculum/workspaces/run-1/cand-01",
      }),
    ).toEqual({
      resolvedCommand: "./gradlew",
      resolution: "unresolved",
    });
    expect(
      resolveRepoLocalWrapperCommand({
        command: "pytest",
        exists: (path) => existing.has(path),
        platform: "linux",
        projectRoot: "/repo",
        scopeRoot: "/repo/.oraculum/workspaces/run-1/cand-01",
      }),
    ).toEqual({
      resolvedCommand: "pytest",
      resolution: "unresolved",
    });
  });
});
