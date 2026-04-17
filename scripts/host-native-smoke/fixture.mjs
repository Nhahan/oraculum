import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createFixtureProject(
  projectRoot,
  scenario,
  expectedValue,
  candidateAgent,
  hostNativeCandidateCount,
  runCommand,
) {
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(join(projectRoot, ".oraculum"), { recursive: true });
  if (scenario.packageJson) {
    await mkdir(join(projectRoot, "test"), { recursive: true });
    await writeFile(
      join(projectRoot, "package.json"),
      `${JSON.stringify(
        {
          name: `oraculum-host-native-smoke-${scenario.id}`,
          private: true,
          type: "module",
          scripts: {
            test: "node --test",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  await writeFile(
    join(projectRoot, scenario.sourcePath),
    'export function message() {\n  return "before";\n}\n',
    "utf8",
  );
  if (scenario.packageJson) {
    await writeFile(
      join(projectRoot, "test", "message.test.js"),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        `import { message } from "../${scenario.sourcePath}";`,
        "",
        'test("message returns the requested literal", () => {',
        `  assert.equal(message(), ${JSON.stringify(expectedValue)});`,
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  await writeFile(
    join(projectRoot, ".oraculum", "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        defaultAgent: candidateAgent,
        defaultCandidates: hostNativeCandidateCount,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, ".oraculum", "advanced.json"),
    `${JSON.stringify(
      {
        version: 1,
        oracles: [
          {
            id: "exact-message-literal",
            roundId: "impact",
            command: process.execPath,
            args: ["-e", buildExactMessageCheckScript(scenario, expectedValue)],
            invariant: "message() returns the exact requested literal.",
            cwd: "workspace",
            enforcement: "hard",
            confidence: "high",
            timeoutMs: 30_000,
            passSummary: "message() returned the exact requested literal.",
            failureSummary: "message() did not return the exact requested literal.",
            repairHint:
              "Set src/message.js to return the exact requested literal without extra punctuation or suffixes.",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (scenario.gitBacked) {
    await runCommand("git", ["init", "-q"], {
      cwd: projectRoot,
      label: "git init",
      timeoutMs: 30_000,
    });
    await runCommand("git", ["config", "user.name", "Host Native Smoke"], {
      cwd: projectRoot,
      label: "git config user.name",
      timeoutMs: 30_000,
    });
    await runCommand("git", ["config", "user.email", "host-native-smoke@example.com"], {
      cwd: projectRoot,
      label: "git config user.email",
      timeoutMs: 30_000,
    });
    await runCommand("git", ["add", "."], {
      cwd: projectRoot,
      label: "git add",
      timeoutMs: 30_000,
    });
    await runCommand("git", ["commit", "-qm", "init"], {
      cwd: projectRoot,
      label: "git commit",
      timeoutMs: 30_000,
    });
  }
}

export function buildExactMessageCheckScript(scenario, expectedValue) {
  return [
    'const { existsSync } = require("node:fs");',
    `const expected = ${JSON.stringify(expectedValue)};`,
    `import(${JSON.stringify(`./${scenario.sourcePath}`)}).then((module) => {`,
    "  const actual = module.message();",
    "  if (actual !== expected) {",
    "    console.error('Expected ' + expected + ', received ' + actual);",
    "    process.exit(1);",
    "  }",
    scenario.packageJson
      ? ""
      : "  if (existsSync('package.json')) { console.error('package.json must not be added'); process.exit(1); }",
    "  console.log(actual);",
    "});",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
