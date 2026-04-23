import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectExplicitCommandCatalog } from "../src/services/consultation-profile/explicit-command-collector.js";
import {
  collectJustTargetSurfaces,
  collectMakeTargetSurfaces,
  collectTaskfileTargetSurfaces,
} from "../src/services/consultation-profile/explicit-command-task-runners.js";
import { collectProfileRepoFacts } from "../src/services/consultation-profile/repo-facts.js";
import {
  createProfileCollectorsTempRoot,
  registerProfileCommandCollectorsCleanup,
} from "./helpers/profile-command-collectors.js";

registerProfileCommandCollectorsCleanup();

describe("profile explicit command collector: task runners", () => {
  it("collects Make, just, and Taskfile targets from explicit repo-local command surfaces", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(join(cwd, "Makefile"), "lint:\n\t@echo lint\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo test\n",
      "utf8",
    );

    const makeTargets = await collectMakeTargetSurfaces(cwd);
    const justTargets = await collectJustTargetSurfaces(cwd);
    const taskTargets = await collectTaskfileTargetSurfaces(cwd);

    expect(makeTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "lint",
          command: "make",
          args: ["lint"],
          pathPolicy: "inherit",
        }),
      ]),
    );
    expect(justTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "typecheck",
          command: "just",
          args: ["typecheck"],
          pathPolicy: "inherit",
        }),
      ]),
    );
    expect(taskTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: "test",
          command: "task",
          args: ["test"],
          pathPolicy: "inherit",
        }),
      ]),
    );
  });

  it("does not surface Make targets that the managed tree excludes", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(join(cwd, "Makefile"), "typecheck:\n\t@echo typecheck\n", "utf8");

    const result = await collectMakeTargetSurfaces(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["Makefile"],
      },
    });

    expect(result).toEqual([]);
  });

  it("keeps excluded repo-local command surfaces out of the explicit command catalog", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "npm@10.0.0" }\n', "utf8");
    await writeFile(join(cwd, "Makefile"), "lint:\n\t@echo lint\n", "utf8");

    const facts = await collectProfileRepoFacts(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["Makefile"],
      },
    });
    const result = await collectExplicitCommandCatalog({
      facts,
      projectRoot: cwd,
      rules: {
        includePaths: [],
        excludePaths: ["Makefile"],
      },
    });

    expect(result.commandCatalog).toEqual([]);
  });

  it("records ambiguous explicit command surfaces instead of relying on collector order", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await writeFile(join(cwd, "Makefile"), "test:\n\t@echo make-test\n", "utf8");
    await writeFile(join(cwd, "justfile"), "typecheck:\n  echo just-typecheck\n", "utf8");
    await writeFile(
      join(cwd, "Taskfile.yml"),
      "version: '3'\n\ntasks:\n  test:\n    cmds:\n      - echo task-test\n",
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);
    const result = await collectExplicitCommandCatalog({ facts, projectRoot: cwd });

    expect(result.commandCatalog).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "full-suite-deep" })]),
    );
    expect(result.commandCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "typecheck-fast",
          command: "just",
          args: ["typecheck"],
        }),
      ]),
    );
    expect(result.skippedCommandCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "full-suite-deep",
          reason: "ambiguous-explicit-command",
        }),
      ]),
    );
  });
});
