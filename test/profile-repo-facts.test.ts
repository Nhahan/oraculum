import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectProfileRepoFacts } from "../src/services/consultation-profile/repo-facts.js";
import {
  createProfileCollectorsTempRoot,
  registerProfileCommandCollectorsCleanup,
} from "./helpers/profile-command-collectors.js";

registerProfileCommandCollectorsCleanup();

describe("profile repo facts collector", () => {
  it("records manifests and lockfiles across root and workspace markers", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "api"), { recursive: true });
    await mkdir(join(cwd, "packages", "web"), { recursive: true });
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "pnpm@9.0.0" }\n', "utf8");
    await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await writeFile(join(cwd, "packages", "api", "pyproject.toml"), "[project]\nname='api'\n");
    await writeFile(join(cwd, "packages", "web", "package.json"), '{ "name": "web" }\n', "utf8");

    const facts = await collectProfileRepoFacts(cwd);

    expect(facts.packageManager).toBe("pnpm");
    expect(facts.workspaceRoots).toEqual(["packages/api", "packages/web"]);
    expect(facts.workspaceMetadata).toEqual([
      {
        label: "api",
        manifests: ["packages/api/pyproject.toml"],
        root: "packages/api",
      },
      {
        label: "web",
        manifests: ["packages/web/package.json"],
        root: "packages/web",
      },
    ]);
    expect(facts.manifests).toEqual([
      "package.json",
      "packages/api/pyproject.toml",
      "packages/web/package.json",
    ]);
    expect(facts.lockfiles).toEqual(["pnpm-lock.yaml"]);
  });

  it("ignores workspace signal paths that are excluded from the managed tree", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "api"), { recursive: true });
    await mkdir(join(cwd, "packages", "docs"), { recursive: true });
    await writeFile(join(cwd, "package.json"), '{ "packageManager": "pnpm@9.0.0" }\n', "utf8");
    await writeFile(join(cwd, "packages", "api", "package.json"), '{ "name": "api" }\n', "utf8");
    await writeFile(join(cwd, "packages", "docs", "package.json"), '{ "name": "docs" }\n', "utf8");

    const facts = await collectProfileRepoFacts(cwd, {
      rules: {
        includePaths: [],
        excludePaths: ["packages/docs"],
      },
    });

    expect(facts.workspaceRoots).toEqual(["packages/api"]);
    expect(facts.workspaceMetadata).toEqual([
      {
        label: "api",
        manifests: ["packages/api/package.json"],
        root: "packages/api",
      },
    ]);
    expect(facts.manifests).toEqual(["package.json", "packages/api/package.json"]);
  });

  it("detects a package manager from explicit workspace package metadata", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify(
        {
          name: "app",
          packageManager: "pnpm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);

    expect(facts.packageManager).toBe("pnpm");
    expect(facts.packageManagerEvidence).toEqual({
      detail: "Package manager detected from workspace package metadata.",
      path: "packages/app/package.json",
      source: "workspace-config",
    });
    expect(facts.workspaceRoots).toEqual(["packages/app"]);
  });

  it("records invalid package manifests without aborting workspace fact collection", async () => {
    const cwd = await createProfileCollectorsTempRoot();
    await mkdir(join(cwd, "packages", "app"), { recursive: true });
    await writeFile(join(cwd, "package.json"), "{\n", "utf8");
    await writeFile(
      join(cwd, "packages", "app", "package.json"),
      `${JSON.stringify({
        name: "app",
        packageManager: "pnpm@10.0.0",
        scripts: {
          lint: 'node -e "process.exit(0)"',
        },
      })}\n`,
      "utf8",
    );

    const facts = await collectProfileRepoFacts(cwd);

    expect(facts.invalidPackageJsons).toEqual(["package.json"]);
    expect(facts.packageJson).toBeUndefined();
    expect(facts.packageManager).toBe("pnpm");
    expect(facts.scripts).toEqual(["lint"]);
    expect(facts.manifests).toEqual(["package.json", "packages/app/package.json"]);
  });
});
