import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync as removeSync,
  writeFileSync as writeFileSyncNode,
} from "node:fs";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distOrcActionsPath = join(repoRoot, "dist", "services", "orc-actions.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const workflowCandidateCount = parseBoundedInteger(
  process.env.ORACULUM_WORKFLOW_COMPARISON_CANDIDATES ?? "4",
  "ORACULUM_WORKFLOW_COMPARISON_CANDIDATES",
  2,
  16,
);

const scenarios = [
  {
    id: "literal-drift",
    invariant: "message() must return the exact requested literal.",
    targetPath: "src/message.js",
    expectedValue: "stable oracle value",
    initialFiles() {
      return {
        "src/message.js": 'export function message() {\n  return "before";\n}\n',
        "test/message.test.js": [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { message } from "../src/message.js";',
          "",
          'test("message stays readable", () => {',
          '  assert.equal(typeof message(), "string");',
          "});",
          "",
        ].join("\n"),
        "checks/invariant.mjs": [
          'import assert from "node:assert/strict";',
          'import { message } from "../src/message.js";',
          `assert.equal(message(), ${JSON.stringify("stable oracle value")});`,
          "",
        ].join("\n"),
      };
    },
    applyBad(root) {
      writeFileSync(
        root,
        "src/message.js",
        `export function message() {\n  return ${JSON.stringify("stable oracle value. K")};\n}\n`,
      );
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/message.js",
        `export function message() {\n  return ${JSON.stringify("stable oracle value")};\n}\n`,
      );
    },
  },
  {
    id: "collateral-damage",
    invariant: "README.md must be preserved while the behavior changes.",
    targetPath: "src/message.js",
    expectedValue: "safe update",
    initialFiles() {
      return {
        "README.md": "KEEP THIS NOTE\n",
        "src/message.js": 'export function message() {\n  return "before";\n}\n',
        "test/message.test.js": [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { message } from "../src/message.js";',
          "",
          'test("message returns the requested value", () => {',
          `  assert.equal(message(), ${JSON.stringify("safe update")});`,
          "});",
          "",
        ].join("\n"),
        "checks/invariant.mjs": [
          'import assert from "node:assert/strict";',
          'import { readFileSync } from "node:fs";',
          'import { message } from "../src/message.js";',
          `assert.equal(message(), ${JSON.stringify("safe update")});`,
          'assert.equal(readFileSync(new URL("../README.md", import.meta.url), "utf8"), "KEEP THIS NOTE\\n");',
          "",
        ].join("\n"),
      };
    },
    applyBad(root) {
      writeFileSync(
        root,
        "src/message.js",
        `export function message() {\n  return ${JSON.stringify("safe update")};\n}\n`,
      );
      rmSync(root, "README.md");
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/message.js",
        `export function message() {\n  return ${JSON.stringify("safe update")};\n}\n`,
      );
    },
  },
  {
    id: "test-tampering",
    invariant: "featureEnabled() must be true even if tests are edited.",
    targetPath: "src/feature.js",
    expectedValue: "true",
    initialFiles() {
      return {
        "src/feature.js": "export function featureEnabled() {\n  return false;\n}\n",
        "test/feature.test.js": [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { featureEnabled } from "../src/feature.js";',
          "",
          'test("feature is enabled", () => {',
          "  assert.equal(featureEnabled(), true);",
          "});",
          "",
        ].join("\n"),
        "checks/invariant.mjs": [
          'import assert from "node:assert/strict";',
          'import { featureEnabled } from "../src/feature.js";',
          "assert.equal(featureEnabled(), true);",
          "",
        ].join("\n"),
      };
    },
    applyBad(root) {
      writeFileSync(
        root,
        "test/feature.test.js",
        [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { featureEnabled } from "../src/feature.js";',
          "",
          'test("feature is enabled", () => {',
          "  assert.equal(featureEnabled(), false);",
          "});",
          "",
        ].join("\n"),
      );
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/feature.js",
        "export function featureEnabled() {\n  return true;\n}\n",
      );
    },
  },
  {
    id: "python-package-free",
    invariant:
      "src/app.py must return the exact requested status literal without package metadata.",
    targetPath: "src/app.py",
    expectedValue: "stable python status",
    packageJson: false,
    validationProfileId: "generic",
    shallowCheck: {
      command: process.execPath,
      args: ["checks/smoke.mjs"],
    },
    initialFiles() {
      return {
        "src/app.py": 'def status():\n    return "before"\n',
        "checks/smoke.mjs": [
          'import assert from "node:assert/strict";',
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("src/app.py", "utf8");',
          "assert.match(source, /def status\\(\\):/);",
          "",
        ].join("\n"),
        "checks/invariant.mjs": [
          'import assert from "node:assert/strict";',
          'import { existsSync, readFileSync } from "node:fs";',
          'const source = readFileSync("src/app.py", "utf8");',
          'assert.equal(existsSync("package.json"), false);',
          `assert.equal(source.includes(${JSON.stringify('return "stable python status"')}), true);`,
          "",
        ].join("\n"),
      };
    },
    applyBad(root) {
      writeFileSync(
        root,
        "src/app.py",
        `def status():\n    return ${JSON.stringify("stable python status. K")}\n`,
      );
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/app.py",
        `def status():\n    return ${JSON.stringify("stable python status")}\n`,
      );
    },
  },
];

async function main() {
  if (!existsSync(distOrcActionsPath)) {
    throw new Error("dist/services/orc-actions.js is missing. Run `npm run build` first.");
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-workflow-comparison-"));
  const fakeCodex = await writeFakeCodexBinary(tempRoot);
  const results = [];

  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(tempRoot, fakeCodex, scenario));
    }

    for (const result of results) {
      process.stdout.write(
        `${result.id}: one-shot shallow=${result.oneShot.shallow} invariant=${result.oneShot.invariant}; oraculum winner=${result.oraculum.winner} crowned=${result.oraculum.crowned}\n`,
      );
    }
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Workflow comparison workspaces preserved at ${tempRoot}\n`);
    }
  }
}

async function runScenario(tempRoot, fakeCodex, scenario) {
  const baseRoot = join(tempRoot, scenario.id, "base");
  const oneShotRoot = join(tempRoot, scenario.id, "one-shot");
  const oraculumRoot = join(tempRoot, scenario.id, "oraculum");

  await writeFixture(baseRoot, scenario);
  await cp(baseRoot, oneShotRoot, { recursive: true });
  await cp(baseRoot, oraculumRoot, { recursive: true });

  scenario.applyBad(oneShotRoot);
  const shallowCheck = scenario.shallowCheck ?? { command: "npm", args: ["test"] };
  const oneShot = {
    shallow: runCheck(shallowCheck.command, shallowCheck.args, oneShotRoot),
    invariant: runCheck(process.execPath, ["checks/invariant.mjs"], oneShotRoot),
  };
  assertEqual(oneShot.shallow, "passed", `${scenario.id}: one-shot shallow test should pass.`);
  assertEqual(oneShot.invariant, "failed", `${scenario.id}: one-shot invariant should fail.`);

  const orcActions = await loadDistOrcActions();
  const restoreEnv = patchEnv({
    ORACULUM_CODEX_BIN: fakeCodex,
    ORACULUM_COMPARISON_SCENARIO: scenario.id,
    ORACULUM_WORKFLOW_COMPARISON_CANDIDATES: String(workflowCandidateCount),
  });
  try {
    const consultation = await orcActions.runConsultAction({
      cwd: oraculumRoot,
      taskInput: scenario.invariant,
      agent: "codex",
      candidates: workflowCandidateCount,
      timeoutMs: 20_000,
    });
    const statuses = Object.fromEntries(
      consultation.consultation.candidates.map((candidate) => [candidate.id, candidate.status]),
    );
    assertEqual(
      statuses["cand-01"],
      "eliminated",
      `${scenario.id}: bad first candidate should be eliminated.`,
    );
    assertEqual(
      consultation.consultation.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: Oraculum should recommend the surviving good candidate.`,
    );

    const crown = await orcActions.runCrownAction({
      cwd: oraculumRoot,
      materializationName: `fix/${scenario.id}`,
      withReport: false,
    });
    assertEqual(crown.plan.winnerId, "cand-02", `${scenario.id}: crowned winner mismatch.`);
    assertEqual(crown.materialization.verified, true, `${scenario.id}: crown should be verified.`);
    assertEqual(
      runCheck(shallowCheck.command, shallowCheck.args, oraculumRoot),
      "passed",
      `${scenario.id}: crowned shallow test should pass.`,
    );
    assertEqual(
      runCheck(process.execPath, ["checks/invariant.mjs"], oraculumRoot),
      "passed",
      `${scenario.id}: crowned invariant should pass.`,
    );

    return {
      id: scenario.id,
      oneShot,
      oraculum: {
        winner: consultation.consultation.recommendedWinner?.candidateId ?? "none",
        crowned: crown.materialization.verified ? "verified" : "unverified",
      },
    };
  } finally {
    restoreEnv();
  }
}

async function writeFixture(root, scenario) {
  await mkdir(root, { recursive: true });
  await mkdir(join(root, ".oraculum"), { recursive: true });
  if (scenario.packageJson !== false) {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify(
        {
          name: `workflow-comparison-${scenario.id}`,
          private: true,
          type: "module",
          scripts: {
            test: "node --test",
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  await writeFile(
    join(root, ".oraculum", "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        defaultAgent: "codex",
        defaultCandidates: workflowCandidateCount,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, ".oraculum", "advanced.json"),
    `${JSON.stringify(
      {
        version: 1,
        oracles: [
          {
            id: "scenario-invariant",
            roundId: "impact",
            command: process.execPath,
            args: ["checks/invariant.mjs"],
            invariant: scenario.invariant,
            cwd: "workspace",
            enforcement: "hard",
            confidence: "high",
            timeoutMs: 30_000,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  for (const [relativePath, contents] of Object.entries(scenario.initialFiles())) {
    await mkdir(dirname(join(root, relativePath)), { recursive: true });
    await writeFile(join(root, relativePath), contents, "utf8");
  }

  runOrThrow("git", ["init", "-q"], root);
  runOrThrow("git", ["config", "user.name", "Workflow Comparison"], root);
  runOrThrow("git", ["config", "user.email", "workflow-comparison@example.com"], root);
  runOrThrow("git", ["add", "."], root);
  runOrThrow("git", ["commit", "-qm", "init"], root);
}

async function writeFakeCodexBinary(root) {
  const scriptPath = join(root, "fake-codex.cjs");
  await writeFile(scriptPath, buildFakeCodexSource(), "utf8");
  if (process.platform === "win32") {
    const wrapperPath = join(root, "fake-codex.cmd");
    await writeFile(
      wrapperPath,
      `@echo off\r\n"${process.execPath}" "%~dp0\\fake-codex.cjs" %*\r\n`,
      "utf8",
    );
    return wrapperPath;
  }

  const wrapperPath = join(root, "fake-codex");
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

function buildFakeCodexSource() {
  const scenarioSpecs = Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      {
        targetPath: scenario.targetPath,
        expectedValue: scenario.expectedValue,
        validationProfileId: scenario.validationProfileId ?? "library",
      },
    ]),
  );

  return `const fs = require("node:fs");
const path = require("node:path");

const scenarios = ${JSON.stringify(scenarioSpecs, null, 2)};
const scenarioId = process.env.ORACULUM_COMPARISON_SCENARIO;
const candidateCount = Number.parseInt(process.env.ORACULUM_WORKFLOW_COMPARISON_CANDIDATES || "4", 10);
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Unknown comparison scenario: " + scenarioId);
  process.exit(1);
}

const prompt = fs.readFileSync(0, "utf8");
const args = process.argv.slice(2);
const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);
const candidateId = candidateMatch ? candidateMatch[1].trim() : "cand-01";
const isPreflight = prompt.includes("You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.");
const isProfile =
  prompt.includes("You are selecting the best Oraculum consultation validation posture");
const isWinner = prompt.includes("You are selecting the best Oraculum finalist.");

function outputPath() {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-o") {
      return args[index + 1] || "";
    }
  }
  return "";
}

function write(relativePath, contents) {
  fs.mkdirSync(path.dirname(path.join(process.cwd(), relativePath)), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), relativePath), contents, "utf8");
}

function applyBadPatch() {
  if (scenarioId === "literal-drift") {
    write("src/message.js", "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue + ". K") + ";\\n}\\n");
    return;
  }
  if (scenarioId === "collateral-damage") {
    write("src/message.js", "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue) + ";\\n}\\n");
    fs.rmSync(path.join(process.cwd(), "README.md"), { force: true });
    return;
  }
  if (scenarioId === "test-tampering") {
    write("test/feature.test.js", [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { featureEnabled } from "../src/feature.js";',
      "",
      'test("feature is enabled", () => {',
      "  assert.equal(featureEnabled(), false);",
      "});",
      "",
    ].join("\\n"));
    return;
  }
  if (scenarioId === "python-package-free") {
    write("src/app.py", "def status():\\n    return " + JSON.stringify(scenario.expectedValue + ". K") + "\\n");
    return;
  }
}

function applyGoodPatch() {
  if (scenarioId === "test-tampering") {
    write("src/feature.js", "export function featureEnabled() {\\n  return true;\\n}\\n");
    return;
  }
  if (scenarioId === "python-package-free") {
    write("src/app.py", "def status():\\n    return " + JSON.stringify(scenario.expectedValue) + "\\n");
    return;
  }
  write(scenario.targetPath, "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue) + ";\\n}\\n");
}

function preflightPayload() {
  return {
    decision: "proceed",
    confidence: "high",
    summary: "The comparison fixture is ready for a repo-only consultation.",
    researchPosture: "repo-only",
  };
}

function profilePayload() {
  return {
    validationProfileId: scenario.validationProfileId,
    confidence: scenario.validationProfileId === "generic" ? "medium" : "high",
    validationSummary: "Controlled workflow comparison fixture.",
    candidateCount,
    strategyIds: ["minimal-change", "test-amplified"],
    selectedCommandIds: ["scenario-invariant"],
    validationGaps: [],
  };
}

function winnerPayload() {
  return {
    decision: "select",
    candidateId: "cand-02",
    confidence: "high",
    summary: "cand-02 is the only invariant-preserving survivor.",
    judgingCriteria: ["The scenario invariant remains satisfied."],
  };
}

if (!isPreflight && !isProfile && !isWinner) {
  if (candidateId === "cand-01") {
    applyBadPatch();
  } else {
    applyGoodPatch();
  }
}

const out = outputPath();
const payload = isPreflight
  ? preflightPayload()
  : isProfile
    ? profilePayload()
    : isWinner
      ? winnerPayload()
      : "Candidate " + candidateId + " materialized.";
if (out) {
  fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
}
process.stdout.write(JSON.stringify({ event: "completed", scenario: scenarioId, candidateId, mode: isPreflight ? "preflight" : isProfile ? "profile" : isWinner ? "winner" : "candidate" }) + "\\n");
`;
}

let cachedOrcActionsModule;

async function loadDistOrcActions() {
  if (!cachedOrcActionsModule) {
    cachedOrcActionsModule = import(pathToFileURL(distOrcActionsPath).href);
  }

  return cachedOrcActionsModule;
}

function writeFileSync(root, relativePath, contents) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSyncNode(filePath, contents, "utf8");
}

function rmSync(root, relativePath) {
  removeSync(join(root, relativePath), { force: true, recursive: true });
}

function runCheck(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
  return result.status === 0 ? "passed" : "failed";
}

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function patchEnv(envPatch) {
  const previous = new Map(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, received ${actual}.`);
  }
}

function parseBoundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
