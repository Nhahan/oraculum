import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync as removeSync,
  writeFileSync as writeFileSyncNode,
} from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distOrcActionsPath = join(repoRoot, "dist", "services", "orc-actions.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const candidateCount = parseBoundedInteger(
  process.env.ORACULUM_SPEC_FIRST_CANDIDATES ?? "4",
  "ORACULUM_SPEC_FIRST_CANDIDATES",
  2,
  16,
);

const scenarios = [
  {
    id: "literal-contract",
    description: "Exact literal contract with an easy-to-spot drift failure.",
    invariant: "message() must return the exact requested literal.",
    targetPath: "src/message.js",
    expectedValue: "stable oracle value",
    initialFiles() {
      return {
        "src/message.js": 'export function message() {\n  return "before";\n}\n',
        "checks/shallow.mjs": [
          'import assert from "node:assert/strict";',
          'import { message } from "../src/message.js";',
          'assert.equal(typeof message(), "string");',
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
    applySpecImplementation(root) {
      this.applyGood(root);
    },
  },
  {
    id: "protected-collateral",
    description: "Target behavior changes while a protected collateral file must stay intact.",
    invariant: "README.md must be preserved while message() changes.",
    targetPath: "src/message.js",
    expectedValue: "safe update",
    initialFiles() {
      return {
        "README.md": "KEEP THIS NOTE\n",
        "src/message.js": 'export function message() {\n  return "before";\n}\n',
        "checks/shallow.mjs": [
          'import assert from "node:assert/strict";',
          'import { message } from "../src/message.js";',
          `assert.equal(message(), ${JSON.stringify("safe update")});`,
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
      this.applyGood(root);
      rmSync(root, "README.md");
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/message.js",
        `export function message() {\n  return ${JSON.stringify("safe update")};\n}\n`,
      );
    },
    applySpecImplementation(root) {
      this.applyGood(root);
    },
  },
  {
    id: "test-tampering",
    description: "A weak implementation edits the test instead of the product code.",
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
        "checks/shallow.mjs": [
          'import assert from "node:assert/strict";',
          'import { existsSync } from "node:fs";',
          'assert.equal(existsSync("test/feature.test.js"), true);',
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
    applySpecImplementation(root) {
      this.applyGood(root);
    },
  },
  {
    id: "implementation-variance",
    description:
      "The selected spec is sound, but the single implementation makes a subtle code mistake.",
    invariant: "parseFlag() must preserve the value after the first equals sign.",
    targetPath: "src/flags.js",
    expectedValue: "alpha=beta",
    initialFiles() {
      return {
        "src/flags.js": "export function parseFlag(input) {\n  return input;\n}\n",
        "checks/shallow.mjs": [
          'import assert from "node:assert/strict";',
          'import { parseFlag } from "../src/flags.js";',
          'assert.equal(typeof parseFlag("--token=value"), "string");',
          "",
        ].join("\n"),
        "checks/invariant.mjs": [
          'import assert from "node:assert/strict";',
          'import { parseFlag } from "../src/flags.js";',
          'assert.equal(parseFlag("--token=alpha=beta"), "alpha=beta");',
          "",
        ].join("\n"),
      };
    },
    applyBad(root) {
      writeFileSync(
        root,
        "src/flags.js",
        [
          "export function parseFlag(input) {",
          "  const parts = input.split('=');",
          "  return parts[1] ?? '';",
          "}",
          "",
        ].join("\n"),
      );
    },
    applyGood(root) {
      writeFileSync(
        root,
        "src/flags.js",
        [
          "export function parseFlag(input) {",
          "  const index = input.indexOf('=');",
          "  return index >= 0 ? input.slice(index + 1) : '';",
          "}",
          "",
        ].join("\n"),
      );
    },
    applySpecImplementation(root) {
      this.applyBad(root);
    },
  },
];

async function main() {
  if (!existsSync(distOrcActionsPath)) {
    throw new Error("dist/services/orc-actions.js is missing. Run `npm run build` first.");
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-spec-first-comparison-"));
  const fakeCodex = await writeFakeCodexBinary(tempRoot);
  const results = [];

  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(tempRoot, fakeCodex, scenario));
    }

    const report = summarizeResults(results);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      [
        "",
        "Summary:",
        `- quality parity: ${report.aggregate.qualityParity}/${report.aggregate.scenarioCount}`,
        `- spec-first lower quality: ${report.aggregate.specFirstLowerQuality}/${report.aggregate.scenarioCount}`,
        `- patch-first model work units: ${report.aggregate.patchFirstModelWorkUnits}`,
        `- spec-first model work units: ${report.aggregate.specFirstModelWorkUnits}`,
        `- estimated model-work reduction: ${report.aggregate.estimatedModelWorkReductionPercent}%`,
        "",
      ].join("\n"),
    );
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Spec-first comparison workspaces preserved at ${tempRoot}\n`);
    }
  }
}

async function runScenario(tempRoot, fakeCodex, scenario) {
  const baseRoot = join(tempRoot, scenario.id, "base");
  const patchFirstRoot = join(tempRoot, scenario.id, "patch-first");
  const specFirstRoot = join(tempRoot, scenario.id, "spec-first");
  const eventLogPath = join(tempRoot, scenario.id, "patch-first-events.jsonl");

  await writeFixture(baseRoot, scenario);
  await cp(baseRoot, patchFirstRoot, { recursive: true });
  await cp(baseRoot, specFirstRoot, { recursive: true });

  const patchFirst = await runPatchFirstRoute(patchFirstRoot, fakeCodex, eventLogPath, scenario);
  const specFirst = runSpecFirstRoute(specFirstRoot, scenario);

  return {
    id: scenario.id,
    description: scenario.description,
    patchFirst,
    specFirst,
    comparison:
      specFirst.quality.score === patchFirst.quality.score
        ? "quality-parity"
        : specFirst.quality.score > patchFirst.quality.score
          ? "spec-first-better"
          : "patch-first-better",
  };
}

async function runPatchFirstRoute(root, fakeCodex, eventLogPath, scenario) {
  const orcActions = await loadDistOrcActions();
  const restoreEnv = patchEnv({
    ORACULUM_CODEX_BIN: fakeCodex,
    ORACULUM_SPEC_FIRST_EVENT_LOG: eventLogPath,
    ORACULUM_SPEC_FIRST_SCENARIO: scenario.id,
    ORACULUM_SPEC_FIRST_CANDIDATES: String(candidateCount),
  });
  try {
    const consultation = await orcActions.runConsultAction({
      cwd: root,
      taskInput: scenario.invariant,
    });
    const crown = await orcActions.runCrownAction({
      cwd: root,
      branchName: `spec-first-benchmark/${scenario.id}`,
      withReport: false,
    });
    const events = await readJsonLines(eventLogPath);
    const modelWorkUnits = estimatePatchFirstModelWork(events);

    if (!crown.materialization.verified) {
      throw new Error(`${scenario.id}: patch-first crown was not verified.`);
    }

    return {
      winner: consultation.consultation.recommendedWinner?.candidateId ?? "none",
      statuses: Object.fromEntries(
        consultation.consultation.candidates.map((candidate) => [candidate.id, candidate.status]),
      ),
      quality: measureQuality(root),
      modelCalls: countEventsByMode(events),
      modelWorkUnits,
    };
  } finally {
    restoreEnv();
  }
}

function runSpecFirstRoute(root, scenario) {
  const specs = buildSpecCandidates(scenario);
  const selectedSpec = specs.find((spec) => spec.id === "spec-02") ?? specs[0];
  if (!selectedSpec) {
    throw new Error(`${scenario.id}: no spec candidate available.`);
  }

  scenario.applySpecImplementation(root, selectedSpec);

  return {
    selectedSpecId: selectedSpec.id,
    quality: measureQuality(root),
    modelCalls: {
      implementation: 1,
      spec: specs.length,
      specJudge: 1,
    },
    modelWorkUnits: estimateSpecFirstModelWork(specs.length),
  };
}

function buildSpecCandidates(scenario) {
  return [
    {
      id: "spec-01",
      summary: `Change ${scenario.targetPath}, but does not fully bind the invariant.`,
    },
    {
      id: "spec-02",
      summary: `Implement ${scenario.invariant} in ${scenario.targetPath} and preserve collateral files.`,
    },
    {
      id: "spec-03",
      summary: "Broad rewrite with weaker reviewability.",
    },
    {
      id: "spec-04",
      summary: "Test-focused plan with insufficient product-code commitment.",
    },
  ].slice(0, candidateCount);
}

async function writeFixture(root, scenario) {
  await mkdir(root, { recursive: true });
  await mkdir(join(root, ".oraculum"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: `spec-first-comparison-${scenario.id}`,
        private: true,
        type: "module",
        scripts: {
          test: "node checks/shallow.mjs",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, ".oraculum", "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        defaultAgent: "codex",
        defaultCandidates: candidateCount,
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
  runOrThrow("git", ["config", "user.name", "Spec First Comparison"], root);
  runOrThrow("git", ["config", "user.email", "spec-first-comparison@example.com"], root);
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
  await writeFile(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

function buildFakeCodexSource() {
  const scenarioSpecs = Object.fromEntries(
    scenarios.map((scenario) => [
      scenario.id,
      {
        expectedValue: scenario.expectedValue,
        targetPath: scenario.targetPath,
      },
    ]),
  );

  return `const fs = require("node:fs");
const path = require("node:path");

const scenarios = ${JSON.stringify(scenarioSpecs, null, 2)};
const scenarioId = process.env.ORACULUM_SPEC_FIRST_SCENARIO;
const scenario = scenarios[scenarioId];
if (!scenario) {
  console.error("Unknown spec-first comparison scenario: " + scenarioId);
  process.exit(1);
}

const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);
const candidateId = candidateMatch ? candidateMatch[1].trim() : "cand-01";
const isPreflight = prompt.includes("You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.");
const isProfile =
  prompt.includes("You are selecting the best Oraculum consultation validation posture");
const isSpecProposal = prompt.includes("You are proposing one Oraculum implementation spec.");
const isSpecSelection = prompt.includes("You are selecting Oraculum implementation specs");
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

function remove(relativePath) {
  fs.rmSync(path.join(process.cwd(), relativePath), { force: true, recursive: true });
}

function applyBadPatch() {
  if (scenarioId === "literal-contract") {
    write("src/message.js", "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue + ". K") + ";\\n}\\n");
    return;
  }
  if (scenarioId === "protected-collateral") {
    write("src/message.js", "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue) + ";\\n}\\n");
    remove("README.md");
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
  if (scenarioId === "implementation-variance") {
    write("src/flags.js", [
      "export function parseFlag(input) {",
      "  const parts = input.split('=');",
      "  return parts[1] ?? '';",
      "}",
      "",
    ].join("\\n"));
  }
}

function applyGoodPatch() {
  if (scenarioId === "test-tampering") {
    write("src/feature.js", "export function featureEnabled() {\\n  return true;\\n}\\n");
    return;
  }
  if (scenarioId === "implementation-variance") {
    write("src/flags.js", [
      "export function parseFlag(input) {",
      "  const index = input.indexOf('=');",
      "  return index >= 0 ? input.slice(index + 1) : '';",
      "}",
      "",
    ].join("\\n"));
    return;
  }
  write(scenario.targetPath, "export function message() {\\n  return " + JSON.stringify(scenario.expectedValue) + ";\\n}\\n");
}

function logEvent(mode) {
  const eventLogPath = process.env.ORACULUM_SPEC_FIRST_EVENT_LOG;
  if (!eventLogPath) {
    return;
  }
  fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
  fs.appendFileSync(
    eventLogPath,
    JSON.stringify({ mode, candidateId, scenarioId, pid: process.pid }) + "\\n",
    "utf8",
  );
}

function preflightPayload() {
  return {
    decision: "proceed",
    confidence: "high",
    summary: "The spec-first comparison fixture is ready for repo-local execution.",
    researchPosture: "repo-only",
  };
}

function profilePayload() {
  const candidateCount = Number.parseInt(process.env.ORACULUM_SPEC_FIRST_CANDIDATES || "4", 10);
  return {
    validationProfileId: "library",
    confidence: "high",
    validationSummary: "Controlled spec-first comparison fixture.",
    candidateCount,
    strategyIds: ["minimal-change", "test-amplified"],
    selectedCommandIds: ["scenario-invariant"],
    validationGaps: [],
  };
}

function winnerPayload() {
  return {
    candidateId: "cand-02",
    confidence: "high",
    summary: "cand-02 is the invariant-preserving implementation.",
  };
}

function specPayload() {
  return {
    summary: "Spec for " + candidateId + " in " + scenario.targetPath,
    approach: "Implement " + scenario.expectedValue + " in " + scenario.targetPath + ".",
    keyChanges: ["Update " + scenario.targetPath + " to satisfy the invariant."],
    expectedChangedPaths: [scenario.targetPath],
    acceptanceCriteria: [scenario.expectedValue + " is produced without weakening checks."],
    validationPlan: ["Run the scenario invariant oracle."],
    riskNotes: [],
  };
}

function specSelectionPayload() {
  const rankedCandidateIds =
    scenarioId === "implementation-variance"
      ? ["cand-01", "cand-02", "cand-03", "cand-04"]
      : ["cand-02", "cand-01", "cand-03", "cand-04"];
  return {
    rankedCandidateIds: rankedCandidateIds.slice(0, Number.parseInt(process.env.ORACULUM_SPEC_FIRST_CANDIDATES || "4", 10)),
    selectedCandidateIds: [rankedCandidateIds[0]],
    implementationVarianceRisk: scenarioId === "implementation-variance" ? "high" : "low",
    validationGaps: [],
    summary:
      scenarioId === "implementation-variance"
        ? "Exercise backup recovery after the first implementation misses a parsing edge case."
        : "Select the invariant-preserving implementation spec first.",
    reasons: rankedCandidateIds
      .slice(0, Number.parseInt(process.env.ORACULUM_SPEC_FIRST_CANDIDATES || "4", 10))
      .map((candidateId, index) => ({
        candidateId,
        rank: index + 1,
        selected: index === 0,
        reason: index === 0 ? "Best spec for this benchmark." : "Lower-ranked benchmark spec.",
      })),
  };
}

let mode = "candidate";
if (isPreflight) {
  mode = "preflight";
} else if (isProfile) {
  mode = "profile";
} else if (isSpecProposal) {
  mode = "spec";
} else if (isSpecSelection) {
  mode = "specJudge";
} else if (isWinner) {
  mode = "winner";
} else if (candidateId === "cand-01") {
  applyBadPatch();
} else {
  applyGoodPatch();
}
logEvent(mode);

const payload = isPreflight
  ? preflightPayload()
  : isProfile
    ? profilePayload()
    : isSpecProposal
      ? specPayload()
      : isSpecSelection
        ? specSelectionPayload()
        : isWinner
          ? winnerPayload()
          : "Candidate " + candidateId + " materialized.";
const out = outputPath();
if (out) {
  fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
}
process.stdout.write(JSON.stringify({ event: "completed", scenarioId, candidateId, mode }) + "\\n");
`;
}

let cachedOrcActionsModule;

async function loadDistOrcActions() {
  if (!cachedOrcActionsModule) {
    cachedOrcActionsModule = import(pathToFileURL(distOrcActionsPath).href);
  }

  return cachedOrcActionsModule;
}

function measureQuality(root) {
  const shallow = runCheck(process.execPath, ["checks/shallow.mjs"], root);
  const invariant = runCheck(process.execPath, ["checks/invariant.mjs"], root);
  return {
    invariant,
    score: invariant === "passed" ? 3 : shallow === "passed" ? 1 : 0,
    shallow,
  };
}

function estimatePatchFirstModelWork(events) {
  const counts = countEventsByMode(events);
  return round1((counts.candidate ?? 0) * 1 + nonCandidateCallCount(counts) * 0.15);
}

function estimateSpecFirstModelWork(specCount) {
  return round1(specCount * 0.25 + 0.15 + 1);
}

function nonCandidateCallCount(counts) {
  return Object.entries(counts)
    .filter(([mode]) => mode !== "candidate")
    .reduce((sum, [, count]) => sum + count, 0);
}

function countEventsByMode(events) {
  const counts = {};
  for (const event of events) {
    counts[event.mode] = (counts[event.mode] ?? 0) + 1;
  }
  return counts;
}

function summarizeResults(results) {
  const patchFirstModelWorkUnits = round1(
    results.reduce((sum, result) => sum + result.patchFirst.modelWorkUnits, 0),
  );
  const specFirstModelWorkUnits = round1(
    results.reduce((sum, result) => sum + result.specFirst.modelWorkUnits, 0),
  );
  const qualityParity = results.filter((result) => result.comparison === "quality-parity").length;
  const specFirstLowerQuality = results.filter(
    (result) => result.comparison === "patch-first-better",
  ).length;
  return {
    aggregate: {
      estimatedModelWorkReductionPercent: round1(
        ((patchFirstModelWorkUnits - specFirstModelWorkUnits) / patchFirstModelWorkUnits) * 100,
      ),
      patchFirstModelWorkUnits,
      qualityParity,
      scenarioCount: results.length,
      specFirstLowerQuality,
      specFirstModelWorkUnits,
    },
    results,
  };
}

async function readJsonLines(path) {
  const raw = await readFile(path, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
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

function parseBoundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
