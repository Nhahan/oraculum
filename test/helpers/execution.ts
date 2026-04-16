import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getAdvancedConfigPath } from "../../src/core/paths.js";
import { writeNodeBinary } from "./fake-binary.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-execution-");

export function registerExecutionTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function writeLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "execution-library",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        type: "module",
        exports: "./src/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(cwd, "src", "index.js"), 'export function greet() {\n  return "Bye";\n}\n');
  await writeFile(
    join(cwd, "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function writeWorkspaceLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "app", "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "execution-workspace-root",
        packageManager: "npm@10.0.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "package.json"),
    `${JSON.stringify(
      {
        name: "@acme/app",
        version: "1.0.0",
        type: "module",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "app", "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function writeWorkspaceLocalEntrypointProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "app", "src"), { recursive: true });
  await writeFile(
    join(cwd, "packages", "app", "pyproject.toml"),
    "[project]\nname='app'\n",
    "utf8",
  );
  await mkdir(join(cwd, "packages", "app", "bin"), { recursive: true });
  await mkdir(join(cwd, "packages", "app", "scripts"), { recursive: true });
  await writeNodeBinary(
    join(cwd, "packages", "app", "bin"),
    "lint",
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "fs.writeFileSync(path.join(process.cwd(), 'lint-marker.txt'), 'lint', 'utf8');",
    ].join("\n"),
  );
  await writeNodeBinary(
    join(cwd, "packages", "app", "scripts"),
    "test",
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "fs.writeFileSync(path.join(process.cwd(), 'test-marker.txt'), 'test', 'utf8');",
    ].join("\n"),
  );
  await writeFile(
    join(cwd, "packages", "app", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
}

export async function writeWorkspaceExportableNpmLibraryProfileProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, "packages", "lib", "src"), { recursive: true });
  await writeFile(
    join(cwd, "packages", "lib", "package.json"),
    `${JSON.stringify(
      {
        name: "@acme/lib",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        type: "module",
        exports: "./src/index.js",
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "lib", "src", "index.js"),
    'export function greet() {\n  return "Bye";\n}\n',
    "utf8",
  );
  await writeFile(
    join(cwd, "packages", "lib", "greet.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { greet } from './src/index.js';",
      "",
      "test('greet returns Hello', () => {",
      "  assert.equal(greet(), 'Hello');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function configureProjectOracles(cwd: string, oracles: unknown[]): Promise<void> {
  await configureAdvancedConfig(cwd, { oracles });
}

export async function configureAdvancedConfig(
  cwd: string,
  update: Record<string, unknown>,
): Promise<void> {
  const configPath = getAdvancedConfigPath(cwd);
  const parsed = await readAdvancedConfig(configPath);
  await writeFile(configPath, `${JSON.stringify({ ...parsed, ...update }, null, 2)}\n`, "utf8");
}

async function readAdvancedConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { version: 1 };
  }
}
