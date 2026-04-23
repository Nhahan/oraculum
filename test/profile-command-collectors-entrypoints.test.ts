import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

import { collectExplicitCommandCatalog } from "../src/services/consultation-profile/explicit-command-collector.js";
import { collectLocalEntrypointSurfaces } from "../src/services/consultation-profile/explicit-command-entrypoints.js";
import { collectProfileRepoFacts } from "../src/services/consultation-profile/repo-facts.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import {
  createProfileCollectorsTempRoot,
  registerProfileCommandCollectorsCleanup,
  withProcessPlatform,
} from "./helpers/profile-command-collectors.js";

registerProfileCommandCollectorsCleanup();

describe("profile explicit command collector: entrypoints", () => {
  it("collects repo-local bin and scripts entrypoints when they are unambiguous", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "bin"), { recursive: true });
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "bin"), "build", 'process.stdout.write("build\\n");');
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("lint\\n");');

    const result = await collectLocalEntrypointSurfaces(cwd);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "build",
          command: posix.join("bin", "build"),
          args: [],
          pathPolicy: "local-only",
        }),
        expect.objectContaining({
          normalizedName: "lint",
          command: posix.join("scripts", "lint"),
          args: [],
          pathPolicy: "local-only",
        }),
      ]),
    );
  });

  it("records ambiguous root-local entrypoints instead of guessing between bin and scripts", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "bin"), { recursive: true });
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "bin"), "lint", 'process.stdout.write("bin\\n");');
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("scripts\\n");');

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lint-fast" })]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-local-command",
          provenance: expect.objectContaining({
            signal: "root-entrypoint:lint",
            source: "local-tool",
          }),
        }),
      ]),
    );
  });

  it("does not surface repo-local entrypoints that the managed tree excludes", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeNodeBinary(join(cwd, "scripts"), "lint", 'process.stdout.write("lint\\n");');

    const result = await collectLocalEntrypointSurfaces(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["scripts"],
      },
    });

    expect(result).toEqual([]);
  });

  it("collects unambiguous workspace-local entrypoints with a workspace-relative cwd", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "packages", "app", "pyproject.toml"), "[project]\nname='app'\n");
    await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
    await mkdir(join(cwd, "packages", "app", "scripts"), { recursive: true });
    await writeNodeBinary(
      join(cwd, "packages", "app", "bin"),
      "lint",
      'process.stdout.write("lint\\n");',
    );
    await writeNodeBinary(
      join(cwd, "packages", "app", "scripts"),
      "test",
      'process.stdout.write("test\\n");',
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          command: posix.join("bin", "lint"),
          args: [],
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
        expect.objectContaining({
          id: "full-suite-deep",
          command: posix.join("scripts", "test"),
          args: [],
          relativeCwd: "packages/app",
          pathPolicy: "local-only",
        }),
      ]),
    );
  });

  it("records portable logical provenance for Windows workspace-local entrypoints", async () => {
    const cwd = await createProfileCollectorsTempRoot();

    await withProcessPlatform("win32", async () => {
      await mkdir(join(cwd, "packages", "app"), { recursive: true });
      await writeFile(join(cwd, "packages", "app", "pyproject.toml"), "[project]\nname='app'\n");
      await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
      await writeNodeBinary(
        join(cwd, "packages", "app", "bin"),
        "lint",
        'process.stdout.write("lint\\n");',
      );

      const result = await collectLocalEntrypointSurfaces(cwd, {
        workspaceRoots: ["packages/app"],
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            normalizedName: "lint",
            command: "bin/lint",
            relativeCwd: "packages/app",
            provenance: expect.objectContaining({
              path: "packages/app/bin/lint",
              signal: "entrypoint:packages/app/bin/lint",
              source: "local-tool",
            }),
          }),
        ]),
      );
    });
  });

  it("records ambiguous workspace-local entrypoints instead of guessing a workspace", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    for (const workspaceRoot of ["packages/app", "packages/web"]) {
      await mkdir(join(cwd, workspaceRoot), { recursive: true });
      await writeFile(join(cwd, workspaceRoot, "pyproject.toml"), "[project]\nname='app'\n");
      await mkdir(join(cwd, workspaceRoot, "bin"), { recursive: true });
      await writeNodeBinary(
        join(cwd, workspaceRoot, "bin"),
        "lint",
        'process.stdout.write("lint\\n");',
      );
    }

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "lint-fast" })]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lint-fast",
          reason: "ambiguous-workspace-command",
          provenance: expect.objectContaining({
            signal: "workspace-entrypoint:lint",
            source: "local-tool",
          }),
        }),
      ]),
    );
  });
});
