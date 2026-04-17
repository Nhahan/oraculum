import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildExplicitMarkerOracle,
  javaStatusFileSegments,
  markerFileSegmentsForScenario,
  nestedWorkspaceStatusFileSegments,
  scenarioSpecificAdvancedConfigKinds,
  taskInputEdgeCases,
} from "./scenarios.mjs";

export async function prepareScenario(
  workdir,
  scenario,
  { invocationCwdForScenario, runInitToolRequest, runOrThrow },
) {
  await mkdir(workdir, { recursive: true });
  await writeRepositoryTemplate(workdir, scenario);
  await writeTaskInputs(workdir, scenario);
  if (scenario.kind === "subdirectory-invocation") {
    await mkdir(invocationCwdForScenario(workdir, scenario), { recursive: true });
  }

  if (scenario.workspaceMode === "git") {
    runOrThrow("git", ["init"], { cwd: workdir });
    runOrThrow("git", ["config", "user.name", "Evidence Bot"], { cwd: workdir });
    runOrThrow("git", ["config", "user.email", "evidence@example.com"], { cwd: workdir });
    runOrThrow("git", ["add", "."], { cwd: workdir });
    runOrThrow("git", ["commit", "-m", "base"], { cwd: workdir });
  }

  await runInitToolRequest({ cwd: workdir });

  if (scenario.kind === "no-finalist") {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "hard-gate",
          roundId: "impact",
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'allow-survivor.txt');",
              "if (fs.existsSync(marker)) { process.stdout.write('allowed'); process.exit(0); }",
              "process.stderr.write('survivor marker missing'); process.exit(1);",
            ].join(" "),
          ],
          invariant: "Candidates must satisfy the repo-local hard gate.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "repair") {
    await writeAdvancedConfig(workdir, {
      version: 1,
      repair: {
        enabled: true,
        maxAttemptsPerRound: 1,
      },
      oracles: [
        {
          id: "needs-repair-marker",
          roundId: "impact",
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'repair-fixed.txt');",
              "if (fs.existsSync(marker)) { process.stdout.write('repair fixed'); process.exit(0); }",
              "process.stderr.write('missing repair marker'); process.exit(1);",
            ].join(" "),
          ],
          invariant: "Candidates must leave a repair marker after the repair attempt.",
          enforcement: "repairable",
          repairHint: "Create repair-fixed.txt in the workspace before finishing the repair pass.",
        },
      ],
    });
  }

  if (scenario.kind === "advanced-override") {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "custom-impact",
          roundId: "impact",
          command: process.execPath,
          args: [
            "-e",
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
              "const candidates = ['src/index.js', 'src/page.js', 'prisma/schema.prisma'].map((entry) => path.join(workspace, entry));",
              "const found = candidates.find((entry) => fs.existsSync(entry));",
              "if (!found) { process.stderr.write('workspace file missing'); process.exit(1); }",
              "process.stdout.write('custom oracle ok');",
            ].join(" "),
          ],
          invariant:
            "The explicit advanced impact oracle should execute instead of inferred defaults.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "nested-workspace") {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "nested-workspace-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("workspaces", "review-app", "tools", "check-status.mjs")],
          invariant: "The nested workspace check must validate the nested target file.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "subdirectory-invocation") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "check-subdirectory-root.mjs"),
      [
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const projectRoot = process.env.ORACULUM_PROJECT_ROOT;",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!projectRoot || !workspace) {",
        '  process.stderr.write("missing Oraculum root/workspace environment");',
        "  process.exit(1);",
        "}",
        'if (!existsSync(join(projectRoot, ".oraculum", "config.json"))) {',
        '  process.stderr.write("project root .oraculum config missing");',
        "  process.exit(1);",
        "}",
        'if (existsSync(join(projectRoot, "packages", "app", ".oraculum"))) {',
        '  process.stderr.write("nested invocation created a stray .oraculum directory");',
        "  process.exit(1);",
        "}",
        'const text = readFileSync(join(workspace, "src", "index.js"), "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("subdirectory root oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "subdirectory-root-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "check-subdirectory-root.mjs")],
          invariant: "A nested invocation must keep project artifacts at the initialized root.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "timed-out-oracle") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "spawn-timeout-child.mjs"),
      [
        'import { spawn } from "node:child_process";',
        'import { join } from "node:path";',
        "",
        "const projectRoot = process.env.ORACULUM_PROJECT_ROOT;",
        "if (!projectRoot) {",
        '  process.stderr.write("missing ORACULUM_PROJECT_ROOT");',
        "  process.exit(1);",
        "}",
        'const markerPath = join(projectRoot, "oracle-timeout-child-survived.txt");',
        "spawn(",
        "  process.execPath,",
        "  [",
        '    "-e",',
        "    [",
        '      "setTimeout(() => require(\\"node:fs\\").writeFileSync(process.env.ORACULUM_TIMEOUT_MARKER_PATH, \\"alive\\\\n\\"), 700);",',
        '      "setInterval(() => {}, 1000);",',
        '    ].join("\\n"),',
        "  ],",
        '  { env: { ...process.env, ORACULUM_TIMEOUT_MARKER_PATH: markerPath }, stdio: "ignore" },',
        ");",
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "timeout-child-cleanup",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "spawn-timeout-child.mjs")],
          invariant: "Timed-out oracle subprocess trees must be cleaned up.",
          enforcement: "signal",
          timeoutMs: 100,
        },
      ],
    });
  }

  if (scenario.kind === "migration-explicit-oracle") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "check-alembic.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!workspace) {",
        '  process.stderr.write("missing ORACULUM_CANDIDATE_WORKSPACE_DIR");',
        "  process.exit(1);",
        "}",
        'const file = join(workspace, "migrations", "versions", "0001_initial.py");',
        'const text = readFileSync(file, "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("explicit alembic oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "migration-explicit-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "check-alembic.mjs")],
          invariant: "The Alembic-shaped fixture must use an explicit repo-local migration check.",
          enforcement: "hard",
        },
      ],
    });
  }

  const explicitMarkerOracle = buildExplicitMarkerOracle(scenario.repoKind);
  if (explicitMarkerOracle && !scenarioSpecificAdvancedConfigKinds.has(scenario.kind)) {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [explicitMarkerOracle],
    });
  }

  if (scenario.binaryMode === "missing") {
    scenario.fakeBinaryPath = join(workdir, "missing-runtime");
  } else {
    const fakeBinaryPath = await writeFakeRuntimeBinary(workdir, scenario);
    scenario.fakeBinaryPath = fakeBinaryPath;
  }

  if (scenario.packageManager) {
    scenario.packageManagerShimDir = await writePackageManagerShim(
      workdir,
      scenario.packageManager,
    );
  }
}

async function writeRepositoryTemplate(root, scenario) {
  const { packageManager, repoKind } = scenario;
  await mkdir(join(root, "src"), { recursive: true });

  if (repoKind === "monorepo") {
    await mkdir(join(root, "packages", "app", "src"), { recursive: true });
    await writeFile(
      join(root, "packages", "app", "src", "index.js"),
      'export function greet() {\n  return "Bye";\n}\n',
      "utf8",
    );
    if ((packageManager ?? "pnpm") === "pnpm") {
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    }
    await writeFile(
      join(root, "turbo.json"),
      '{ "$schema": "https://turbo.build/schema.json" }\n',
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-monorepo",
      version: "0.0.0",
      private: true,
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(root, "packages", "app"), {
      name: "@acme/app",
      version: "0.0.0",
      type: "module",
      main: "./src/index.js",
      exports: {
        ".": "./src/index.js",
      },
    });
    await writeProjectLocalTool(
      root,
      "turbo",
      `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "packages", "app", "src", "index.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing monorepo app entry");
  process.exit(1);
}
	process.stdout.write("turbo workspace ok");
	`,
    );
    for (const [dir, name] of [
      ["bin", "lint"],
      ["scripts", "typecheck"],
      ["scripts", "test"],
      ["bin", "build"],
    ]) {
      await writeRepoEntrypoint(
        root,
        dir,
        name,
        `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "packages", "app", "src", "index.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing monorepo app entry");
  process.exit(1);
}
process.stdout.write(${JSON.stringify(`${name} workspace ok`)});
`,
      );
    }
    return;
  }

  if (repoKind === "library" || repoKind === "plain") {
    await writeFile(
      join(root, "src", "index.js"),
      'export function greet() {\n  return "Bye";\n}\n',
      "utf8",
    );
    if (scenario.kind === "large-diff") {
      await mkdir(join(root, "src", "tree", "nested"), { recursive: true });
      await writeFile(join(root, "src", "tree", "rename-me.txt"), "rename me\n", "utf8");
      await writeFile(join(root, "src", "tree", "delete-me.txt"), "delete me\n", "utf8");
      await writeFile(join(root, "src", "tree", "nested", "keep.txt"), "keep\n", "utf8");
      for (let index = 0; index < 20; index += 1) {
        await writeFile(
          join(root, "src", "tree", `bulk-${String(index).padStart(2, "0")}.txt`),
          "base\n",
          "utf8",
        );
      }
    }
  }

  if (repoKind === "docs") {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "report.md"),
      "# Baseline report\n\nThe current report needs editorial cleanup.\n",
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-docs",
      version: "0.0.0",
      type: "module",
      scripts: {
        lint: `${nodeEval("process.exit(0)")}`,
        typecheck: `${nodeEval("process.exit(0)")}`,
        test: `${nodeEval("process.exit(0)")}`,
        build: `${nodeEval("process.exit(0)")}`,
      },
    });
    return;
  }

  if (repoKind === "docs-static") {
    await mkdir(join(root, "site"), { recursive: true });
    await writeFile(
      join(root, "site", "index.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        "    <title>Scenario Docs</title>",
        "  </head>",
        "  <body>",
        '    <p data-status="offline">offline</p>',
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
      "utf8",
    );
    return;
  }

  if (repoKind === "python") {
    await writeFile(join(root, "src", "app.py"), 'def status():\n    return "offline"\n', "utf8");
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "scenario-python"\n');
    return;
  }

  if (repoKind === "go") {
    await mkdir(join(root, "internal", "status"), { recursive: true });
    await writeFile(join(root, "go.mod"), "module example.com/scenario\n\ngo 1.22\n", "utf8");
    await writeFile(
      join(root, "internal", "status", "status.go"),
      'package status\n\nfunc Status() string {\n\treturn "offline"\n}\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "rust") {
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname = "scenario-rust"\nversion = "0.1.0"\nedition = "2021"\n',
      "utf8",
    );
    await writeFile(
      join(root, "src", "lib.rs"),
      "pub fn status() -> &" + 'static str {\n    "offline"\n}\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "java-gradle") {
    await writeFile(
      join(root, "settings.gradle"),
      "rootProject.name = 'scenario-gradle'\n",
      "utf8",
    );
    await writeFile(join(root, "build.gradle"), "plugins {\n  id 'java'\n}\n", "utf8");
    await writeJavaStatusSource(root);
    return;
  }

  if (repoKind === "java-maven") {
    await writeFile(
      join(root, "pom.xml"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<project>",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>example</groupId>",
        "  <artifactId>scenario-maven</artifactId>",
        "  <version>0.1.0</version>",
        "</project>",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeJavaStatusSource(root);
    return;
  }

  if (repoKind === "polyglot") {
    await mkdir(join(root, "services", "worker"), { recursive: true });
    await writePackageJson(root, {
      name: "scenario-polyglot",
      version: "0.0.0",
      type: "module",
    });
    await writeFile(join(root, "src", "index.js"), 'export const status = "offline";\n', "utf8");
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "scenario-polyglot"\n');
    await writeFile(join(root, "go.mod"), "module example.com/polyglot\n\ngo 1.22\n", "utf8");
    await writeFile(join(root, "services", "worker", "app.py"), 'STATUS = "offline"\n', "utf8");
    return;
  }

  if (repoKind === "nested-workspace") {
    await mkdir(join(root, "workspaces", "review-app", "tools"), { recursive: true });
    await mkdir(join(root, "workspaces", "review-app", "src"), { recursive: true });
    await writeFile(join(root, ...nestedWorkspaceStatusFileSegments), 'status="offline"\n', "utf8");
    await writeFile(
      join(root, "workspaces", "review-app", "tools", "check-status.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!workspace) {",
        '  process.stderr.write("missing ORACULUM_CANDIDATE_WORKSPACE_DIR");',
        "  process.exit(1);",
        "}",
        'const file = join(workspace, "workspaces", "review-app", "src", "status.txt");',
        'const text = readFileSync(file, "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("nested workspace oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    return;
  }

  if (repoKind === "alembic") {
    await mkdir(join(root, "migrations", "versions"), { recursive: true });
    await writeFile(join(root, "alembic.ini"), "[alembic]\nscript_location = migrations\n", "utf8");
    await writeFile(
      join(root, "migrations", "env.py"),
      'def run_migrations_online():\n    return "offline"\n',
      "utf8",
    );
    await writeFile(
      join(root, "migrations", "versions", "0001_initial.py"),
      'revision_message = "offline"\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "service") {
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "src", "server.js"),
      'export function serviceStatus() {\n  return "offline";\n}\n',
      "utf8",
    );
    await writeFile(
      join(root, "routes", "health.js"),
      'export const healthRoute = "/health";\n',
      "utf8",
    );
    await writeFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.0",
        "info:",
        "  title: Service API",
        "  version: 0.0.0",
        "paths:",
        "  /health:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: ok",
        "",
      ].join("\n"),
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-service",
      version: "0.0.0",
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      main: "./src/server.js",
      exports: {
        ".": "./src/server.js",
      },
      dependencies: {
        fastify: "0.0.0",
      },
    });
    for (const [dir, name] of [
      ["bin", "lint"],
      ["scripts", "typecheck"],
      ["scripts", "test"],
      ["bin", "build"],
    ]) {
      await writeRepoEntrypoint(
        root,
        dir,
        name,
        `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "src", "server.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing service entry");
  process.exit(1);
}
process.stdout.write(${JSON.stringify(`${name} service ok`)});
`,
      );
    }
    return;
  }

  if (repoKind === "frontend") {
    await writeFile(join(root, "src", "page.js"), 'export const TITLE = "Old Title";\n', "utf8");
    await writePackageJson(root, {
      name: "scenario-frontend",
      version: "0.0.0",
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      scripts: {
        lint: `${nodeEval("process.exit(0)")}`,
        typecheck: `${nodeEval("process.exit(0)")}`,
        build: `${nodeEval("process.exit(0)")}`,
        "test:changed": `${nodeEval("process.exit(0)")}`,
      },
      dependencies: {
        react: "0.0.0",
        "@playwright/test": "0.0.0",
      },
    });
    await writeFile(join(root, "playwright.config.ts"), "export default {};\n", "utf8");
    await writeProjectLocalTool(
      root,
      "playwright",
      `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "src", "page.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing page");
  process.exit(1);
}
process.stdout.write("playwright ok");
`,
    );
    return;
  }

  if (repoKind === "migration") {
    await mkdir(join(root, "prisma", "migrations", "0001_init"), { recursive: true });
    await writeFile(
      join(root, "prisma", "schema.prisma"),
      [
        "datasource db {",
        '  provider = "sqlite"',
        '  url      = "file:dev.db"',
        "}",
        "",
        "generator client {",
        '  provider = "prisma-client-js"',
        "}",
        "",
        "model User {",
        "  id   Int    @id @default(autoincrement())",
        "  name String",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "prisma", "migrations", "0001_init", "migration.sql"),
      "-- migration\n",
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-migration",
      version: "0.0.0",
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      scripts: {
        lint: `${nodeEval("process.exit(0)")}`,
        typecheck: `${nodeEval("process.exit(0)")}`,
      },
      dependencies: {
        prisma: "0.0.0",
        "@prisma/client": "0.0.0",
      },
    });
    await writeProjectLocalTool(
      root,
      "prisma",
      `const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const schemaIndex = args.indexOf("--schema");
const schemaPath = schemaIndex >= 0 ? args[schemaIndex + 1] : "prisma/schema.prisma";
const resolved = path.join(process.cwd(), schemaPath);
if (!fs.existsSync(resolved)) {
  process.stderr.write("missing schema");
  process.exit(1);
}
if (args[0] === "migrate" && args[1] === "diff") {
  process.stdout.write("migration diff ok");
  process.exit(0);
}
if (args[0] === "migrate" && args[1] === "status") {
  process.stdout.write("migration status ok");
  process.exit(0);
}
if (args[0] === "validate") {
  process.stdout.write("schema valid");
  process.exit(0);
}
process.stderr.write("unsupported prisma invocation");
process.exit(1);
`,
    );
    return;
  }

  if (repoKind === "library") {
    await writePackageJson(root, {
      name: "scenario-library",
      version: "0.0.0",
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      main: "./src/index.js",
      exports: {
        ".": "./src/index.js",
      },
      scripts: {
        lint: `${nodeEval("process.exit(0)")}`,
        typecheck: `${nodeEval("process.exit(0)")}`,
        test: `${nodeEval("process.exit(0)")}`,
        build: `${nodeEval("process.exit(0)")}`,
      },
    });
    return;
  }
}

async function writeJavaStatusSource(root) {
  await mkdir(join(root, "src", "main", "java", "example"), { recursive: true });
  await writeFile(
    join(root, ...javaStatusFileSegments),
    [
      "package example;",
      "",
      "public final class Status {",
      "  private Status() {}",
      "",
      "  public static String status() {",
      '    return "offline";',
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeTaskInputs(root, scenario) {
  const { repoKind, taskInputMode } = scenario;
  await mkdir(join(root, "tasks"), { recursive: true });
  const taskBodies = {
    library: "# Library patch\nUpdate the greeting implementation.\n",
    frontend: "# Frontend patch\nUpdate the page title.\n",
    migration: "# Migration patch\nAdjust the schema comment.\n",
    plain: "# Plain patch\nUpdate the greeting text.\n",
    python: "# Python patch\nUpdate the service status text.\n",
    go: "# Go patch\nUpdate the service status text.\n",
    rust: "# Rust patch\nUpdate the service status text.\n",
    "java-gradle": "# Java/Gradle patch\nUpdate the service status text.\n",
    "java-maven": "# Java/Maven patch\nUpdate the service status text.\n",
    "docs-static": "# Static docs patch\nUpdate the page status text.\n",
    polyglot: "# Polyglot patch\nUpdate the worker status text.\n",
    "nested-workspace": "# Nested workspace patch\nUpdate the nested status text.\n",
    alembic: "# Alembic migration patch\nUpdate the migration revision marker.\n",
    docs: "# Docs patch\nRevise the report wording.\n",
    service: "# Service patch\nUpdate the service status response.\n",
    monorepo: "# Monorepo patch\nUpdate the workspace package greeting.\n",
  };
  await writeFile(join(root, "tasks", `${repoKind}.md`), taskBodies[repoKind], "utf8");
  const edgeCase = taskInputEdgeCases[taskInputMode];
  if (edgeCase?.taskBody) {
    const edgeTaskPath = join(root, ...edgeCase.pathSegments);
    await mkdir(dirname(edgeTaskPath), { recursive: true });
    await writeFile(edgeTaskPath, edgeCase.taskBody, "utf8");
  }
}

async function writePackageJson(root, json) {
  await writeFile(join(root, "package.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function writeAdvancedConfig(root, json) {
  const oraculumDir = join(root, ".oraculum");
  await mkdir(oraculumDir, { recursive: true });
  await writeFile(join(oraculumDir, "advanced.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function writeProjectLocalTool(root, name, source) {
  const binDir = join(root, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  await writeNodeBinary(binDir, name, source);
}

async function writeRepoEntrypoint(root, relativeDir, name, source) {
  const dir = join(root, relativeDir);
  await mkdir(dir, { recursive: true });
  await writeNodeBinary(dir, name, source);
}

async function writePackageManagerShim(root, packageManager) {
  const shimDir = join(root, ".oraculum", "pm-shims");
  await mkdir(shimDir, { recursive: true });
  await writeNodeBinary(
    shimDir,
    packageManager,
    `const { existsSync } = require("node:fs");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const manager = ${JSON.stringify(packageManager)};
const args = process.argv.slice(2);

function passThrough(result) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}

function localToolPath(tool) {
  const binDir = join(process.cwd(), "node_modules", ".bin");
  const candidates = process.platform === "win32"
    ? [join(binDir, tool + ".cmd"), join(binDir, tool)]
    : [join(binDir, tool)];
  return candidates.find((candidate) => existsSync(candidate));
}

function scriptEnvironment() {
  const binDir = join(process.cwd(), "node_modules", ".bin");
  return {
    ...process.env,
    PATH: process.platform === "win32"
      ? binDir + ";" + (process.env.PATH || "")
      : binDir + ":" + (process.env.PATH || ""),
  };
}

function runLocalTool(tool, toolArgs) {
  const executable = localToolPath(tool);
  if (!executable) {
    process.stderr.write("missing local tool: " + tool);
    process.exit(1);
  }
  passThrough(spawnSync(executable, toolArgs, { cwd: process.cwd(), env: scriptEnvironment(), encoding: "utf8", stdio: "pipe" }));
}

function packageScripts() {
  const packageJsonPath = join(process.cwd(), "package.json");
  if (!existsSync(packageJsonPath)) {
    process.stderr.write("missing package.json");
    process.exit(1);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson.scripts || {};
}

function runPackageScript(scriptName) {
  const scripts = packageScripts();
  const script = scripts[scriptName];
  if (!script) {
    process.stderr.write("missing package script: " + scriptName);
    process.exit(1);
  }
  passThrough(
    spawnSync(script, {
      cwd: process.cwd(),
      env: scriptEnvironment(),
      encoding: "utf8",
      stdio: "pipe",
      shell: true,
    }),
  );
}

if (manager === "pnpm") {
  if (args[0] === "run" && args[1]) runPackageScript(args[1]);
  if (args[0] === "exec" && args[1]) runLocalTool(args[1], args.slice(2));
}

if (manager === "yarn") {
  if (args[0] === "exec" && args[1]) runLocalTool(args[1], args.slice(2));
  if (args[0] && args[0] !== "exec") runPackageScript(args[0]);
}

if (manager === "bun") {
  if (args[0] === "run" && args[1]) runPackageScript(args[1]);
  if (args[0] === "x" && args[1]) runLocalTool(args[1], args.slice(2));
}

process.stderr.write("unsupported package manager invocation: " + manager + " " + args.join(" "));
process.exit(1);
`,
  );
  return shimDir;
}

async function writeFakeRuntimeBinary(root, scenario) {
  return writeNodeBinary(
    root,
    scenario.agent === "codex" ? "fake-codex" : "fake-claude",
    buildFakeRuntimeSource(scenario),
  );
}

function buildFakeRuntimeSource(scenario) {
  return `const fs = require("node:fs");
const path = require("node:path");

const prompt = fs.readFileSync(0, "utf8");
const args = process.argv.slice(2);
const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);
const candidateId = candidateMatch ? candidateMatch[1].trim() : "cand-01";
const isPreflight = prompt.includes("You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.");
const isProfile =
  prompt.includes("You are selecting the best Oraculum consultation validation posture") ||
  prompt.includes("You are selecting the best Oraculum consultation profile");
const isWinner = prompt.includes("You are selecting the best Oraculum finalist.");
const isRepair = prompt.includes("Repair context:");
const scenario = ${JSON.stringify({
    kind: scenario.kind,
    repoKind: scenario.repoKind,
    profileId: scenario.profileId,
    candidateCount: scenario.candidateCount,
    agent: scenario.agent,
  })};
const explicitMarkerFileSegments = ${JSON.stringify(
    markerFileSegmentsForScenario(scenario.repoKind),
  )};

function mutateWorkspace() {
  if (scenario.kind === "hung-runtime") {
    setTimeout(() => {}, 60000);
    return;
  }
  if (scenario.kind === "large-diff") {
    const treeRoot = path.join(process.cwd(), "src", "tree");
    fs.renameSync(path.join(treeRoot, "rename-me.txt"), path.join(treeRoot, "renamed-" + candidateId + ".txt"));
    fs.rmSync(path.join(treeRoot, "delete-me.txt"), { force: true });
    for (let index = 0; index < 20; index += 1) {
      fs.writeFileSync(path.join(treeRoot, "bulk-" + String(index).padStart(2, "0") + ".txt"), "patched-" + candidateId + "\\n", "utf8");
    }
    fs.writeFileSync(path.join(treeRoot, "nested", "generated-" + candidateId + ".txt"), "generated " + candidateId + "\\n", "utf8");
    fs.writeFileSync(path.join(process.cwd(), "src", "index.js"), 'export function greet() {\\n  return "Hello from ' + candidateId + '";\\n}\\n', "utf8");
    return;
  }
  if (scenario.repoKind === "monorepo") {
    const file = path.join(process.cwd(), "packages", "app", "src", "index.js");
    const next = fs.readFileSync(file, "utf8").replace('"Bye"', '"Hello from ' + candidateId + '"');
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (scenario.repoKind === "frontend") {
    const file = path.join(process.cwd(), "src", "page.js");
    const next = fs.readFileSync(file, "utf8").replace("Old Title", "Title " + candidateId);
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (scenario.repoKind === "migration") {
    const file = path.join(process.cwd(), "prisma", "schema.prisma");
    const next = fs.readFileSync(file, "utf8").replace("model User {", "// candidate " + candidateId + "\\nmodel User {");
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (scenario.repoKind === "docs") {
    const file = path.join(process.cwd(), "docs", "report.md");
    const next = fs.readFileSync(file, "utf8").replace("Baseline report", "Report for " + candidateId);
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (explicitMarkerFileSegments) {
    const file = path.join(process.cwd(), ...explicitMarkerFileSegments);
    const next = fs.readFileSync(file, "utf8").replace('"offline"', '"online-' + candidateId + '"');
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (scenario.repoKind === "service") {
    const file = path.join(process.cwd(), "src", "server.js");
    const next = fs.readFileSync(file, "utf8").replace('"offline"', '"online-' + candidateId + '"');
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  const file = path.join(process.cwd(), "src", "index.js");
  const next = fs.readFileSync(file, "utf8").replace('"Bye"', '"Hello from ' + candidateId + '"');
  fs.writeFileSync(file, next, "utf8");
}

function candidateSummary() {
  if (scenario.kind === "no-finalist") {
    return "Candidate left a patch, but repo-local hard gates will reject it.";
  }
  if (scenario.kind === "repair" && isRepair) {
    return "Candidate repaired the missing marker.";
  }
  return "Candidate materialized a patch.";
}

function preflightPayload() {
  return {
    decision: "proceed",
    confidence: scenario.repoKind === "plain" ? "medium" : "high",
    summary: scenario.repoKind === "plain"
      ? "The repository provides enough grounding to begin a repo-only consultation."
      : "The repository signals are sufficient to start the consultation without external research.",
    researchPosture: "repo-only",
  };
}

function winnerPayload() {
  if (scenario.kind === "abstain" || scenario.kind === "manual-crown") {
    return { decision: "abstain", confidence: "medium", summary: "Survivors are too close to recommend automatically." };
  }
  const recommendedId = scenario.candidateCount > 1 ? "cand-02" : "cand-01";
  return { candidateId: recommendedId, confidence: "high", summary: recommendedId + " preserved the strongest evidence." };
}

function profilePayload() {
  const selectedCommandIds = scenario.profileId === "frontend"
    ? ["lint-fast"]
    : scenario.profileId === "migration"
      ? ["lint-fast"]
      : ["lint-fast"];
  return {
    profileId: scenario.profileId,
    confidence: scenario.repoKind === "plain" ? "low" : "high",
    summary: scenario.profileId + " profile fits the repository signals.",
    candidateCount: scenario.candidateCount,
    strategyIds: scenario.profileId === "migration"
      ? ["safety-first", "structural-refactor"]
      : ["minimal-change", "test-amplified"],
    selectedCommandIds,
    missingCapabilities: [],
  };
}

if (!isPreflight && !isProfile && !isWinner) {
  if (scenario.kind !== "no-finalist") {
    mutateWorkspace();
  } else {
    mutateWorkspace();
  }
  if (scenario.kind === "repair" && isRepair) {
    fs.writeFileSync(path.join(process.cwd(), "repair-fixed.txt"), "ok\\n", "utf8");
  }
}

if (scenario.agent === "codex") {
  let out = "";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-o") {
      out = args[index + 1] || "";
    }
  }
  process.stdout.write(JSON.stringify({ event: "started", mode: isPreflight ? "preflight" : isProfile ? "profile" : isWinner ? "winner" : "candidate" }) + "\\n");
  if (out) {
    const payload = isPreflight
      ? preflightPayload()
      : isProfile
        ? profilePayload()
        : isWinner
          ? winnerPayload()
          : candidateSummary();
    fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  }
  process.stderr.write("");
  process.exit(0);
}

const payload = isPreflight
  ? { result: preflightPayload() }
  : isProfile
    ? { result: profilePayload() }
    : isWinner
      ? { result: winnerPayload() }
      : { result: candidateSummary() };
process.stdout.write(JSON.stringify(payload));
`;
}

async function writeNodeBinary(root, name, source) {
  const scriptPath = join(root, `${name}.cjs`);
  await writeFile(scriptPath, source, "utf8");

  if (process.platform === "win32") {
    const wrapperPath = join(root, `${name}.cmd`);
    const nodePath = process.execPath.replace(/"/g, '""');
    await writeFile(wrapperPath, `@echo off\r\n"${nodePath}" "%~dp0\\${name}.cjs" %*\r\n`, "utf8");
    return wrapperPath;
  }

  const wrapperPath = join(root, name);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}
