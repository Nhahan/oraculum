import { describe, expect, it } from "vitest";

import {
  collectOracleLocalToolPaths,
  listRelativeLocalToolDirs,
  resolveRepoLocalEntrypointCommand,
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

  it("materializes Windows local tool directories with native absolute paths", () => {
    const existing = new Set([
      "C:\\repo\\.oraculum\\workspaces\\run-1\\cand-01\\node_modules\\.bin",
      "C:\\repo\\.oraculum\\workspaces\\run-1\\cand-01\\.venv\\Scripts",
      "C:\\repo\\node_modules\\.bin",
      "C:\\repo\\bin",
    ]);

    const paths = collectOracleLocalToolPaths({
      exists: (path) => existing.has(path),
      platform: "win32",
      projectRoot: "C:/repo",
      workspaceDir: "C:/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(paths).toEqual([
      "C:\\repo\\.oraculum\\workspaces\\run-1\\cand-01\\node_modules\\.bin",
      "C:\\repo\\.oraculum\\workspaces\\run-1\\cand-01\\.venv\\Scripts",
      "C:\\repo\\node_modules\\.bin",
      "C:\\repo\\bin",
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
    const existing = new Set(["C:\\repo\\mvnw.cmd"]);

    const resolved = resolveRepoLocalWrapperCommand({
      command: "mvnw",
      exists: (path) => existing.has(path),
      platform: "win32",
      projectRoot: "C:/repo",
      scopeRoot: "C:/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(resolved).toEqual({
      resolvedCommand: "C:\\repo\\mvnw.cmd",
      resolution: "project-wrapper",
    });
  });

  it("resolves Windows Gradle cmd wrappers from the project root", () => {
    const existing = new Set(["C:\\repo\\gradlew.cmd"]);

    const resolved = resolveRepoLocalWrapperCommand({
      command: "gradlew",
      exists: (path) => existing.has(path),
      platform: "win32",
      projectRoot: "C:/repo",
      scopeRoot: "C:/repo/.oraculum/workspaces/run-1/cand-01",
    });

    expect(resolved).toEqual({
      resolvedCommand: "C:\\repo\\gradlew.cmd",
      resolution: "project-wrapper",
    });
  });

  it("resolves repo-local Windows entrypoints from logical command paths", () => {
    const existing = new Set(["C:\\repo\\packages\\app\\bin\\lint.cmd"]);

    const resolved = resolveRepoLocalEntrypointCommand({
      command: "bin/lint",
      cwd: "C:/repo/packages/app",
      exists: (path) => existing.has(path),
      platform: "win32",
    });

    expect(resolved).toEqual({
      resolvedCommand: "C:\\repo\\packages\\app\\bin\\lint.cmd",
      resolution: "local-entrypoint",
    });
  });

  it("resolves repo-local POSIX shell entrypoints from logical command paths", () => {
    const existing = new Set(["/repo/packages/app/scripts/test.sh"]);

    const resolved = resolveRepoLocalEntrypointCommand({
      command: "scripts/test",
      cwd: "/repo/packages/app",
      exists: (path) => existing.has(path),
      platform: "linux",
    });

    expect(resolved).toEqual({
      resolvedCommand: "/repo/packages/app/scripts/test.sh",
      resolution: "local-entrypoint",
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
    expect(
      resolveRepoLocalEntrypointCommand({
        command: "./bin/lint",
        cwd: "/repo/packages/app",
        exists: (path) => existing.has(path),
        platform: "linux",
      }),
    ).toEqual({
      resolvedCommand: "./bin/lint",
      resolution: "unresolved",
    });
  });
});
