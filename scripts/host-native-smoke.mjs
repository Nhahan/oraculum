import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] ? resolvePath(process.argv[1]) === scriptPath : false;
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const timeoutMs = Number.parseInt(process.env.ORACULUM_HOST_NATIVE_TIMEOUT_MS ?? "300000", 10);
const claudeModel = process.env.ORACULUM_HOST_NATIVE_CLAUDE_MODEL ?? "sonnet";
const runtimeInput = process.env.ORACULUM_HOST_NATIVE_RUNTIMES ?? "claude-code,codex";
const candidateAgentInput = process.env.ORACULUM_HOST_NATIVE_AGENT ?? "host";
const scenarioInput = process.env.ORACULUM_HOST_NATIVE_SCENARIOS ?? "node-package,package-free";
const settleTimeoutMs = Number.parseInt(
  process.env.ORACULUM_HOST_NATIVE_SETTLE_TIMEOUT_MS ?? "60000",
  10,
);
const hostNativeCandidateCount = parseBoundedInteger(
  process.env.ORACULUM_HOST_NATIVE_CANDIDATES ?? "1",
  "ORACULUM_HOST_NATIVE_CANDIDATES",
  1,
  16,
);
const skipSetup = process.env.ORACULUM_HOST_NATIVE_SKIP_SETUP === "1";
const runtimes = runtimeInput
  .split(",")
  .map((runtime) => runtime.trim())
  .filter((runtime) => runtime.length > 0);
const scenarios = resolveScenarios(scenarioInput);

async function main() {
  assertRuntimes(runtimes);
  assertCandidateAgent(candidateAgentInput);

  if (!existsSync(join(repoRoot, "dist", "cli.js"))) {
    throw new Error("dist/cli.js is missing. Run `npm run build` before host-native smoke.");
  }

  if (!skipSetup) {
    for (const runtime of runtimes) {
      await setupRuntime(runtime);
    }
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-host-native-smoke-"));
  const results = [];

  try {
    for (const runtime of runtimes) {
      for (const scenario of scenarios) {
        results.push(await runRuntimeSmoke(tempRoot, runtime, scenario));
      }
    }

    for (const result of results) {
      process.stdout.write(
        `${[
          `Host-native smoke passed for ${result.runtime}.`,
          `scenario=${result.scenario}`,
          `run=${result.runId}`,
          `branch=${result.branchName}`,
          `value=${result.value}`,
          `agent=${result.candidateAgent}`,
          `candidates=${result.candidateCount}`,
          `toolCalls=${result.toolCalls.consult}/${result.toolCalls.crown}`,
        ].join(" ")}\n`,
      );
    }
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Host-native smoke workspace preserved at ${tempRoot}\n`);
    }
  }
}

async function setupRuntime(runtime) {
  await runCommand(
    process.execPath,
    [join(repoRoot, "dist", "cli.js"), "setup", "--runtime", runtime],
    {
      cwd: repoRoot,
      label: `setup ${runtime}`,
      timeoutMs,
    },
  );
}

async function runRuntimeSmoke(tempRoot, runtime, scenario) {
  const projectRoot = join(tempRoot, `${runtime}-${scenario.id}-project`);
  const evidenceRoot = join(tempRoot, `${runtime}-${scenario.id}-evidence`);
  const expectedValue = `hello from ${runtime} ${scenario.id} host-native smoke`;
  const branchName = `fix/${runtime}-${scenario.id}-host-native-smoke`;
  const candidateAgent = resolveCandidateAgent(runtime);
  await createFixtureProject(projectRoot, scenario, expectedValue, candidateAgent);
  await mkdir(evidenceRoot, { recursive: true });

  const packageConstraint = scenario.packageJson
    ? "Keep the patch minimal. Do not edit tests or .oraculum configuration."
    : "This repository intentionally has no package.json; do not add package.json, npm scripts, or package metadata. Keep the patch minimal. Do not edit .oraculum configuration.";
  const consultPrompt = `orc consult "Change ${scenario.sourcePath} so message() returns exactly ${JSON.stringify(expectedValue)}. ${packageConstraint}"`;
  const consult = await runHost(runtime, projectRoot, consultPrompt);
  const consultLogPath = join(evidenceRoot, `${runtime}-consult.jsonl`);
  await writeFile(consultLogPath, consult.stdout + consult.stderr, "utf8");
  const consultToolCalls = countToolCalls(runtime, consult.stdout + consult.stderr, "consult");
  if (consultToolCalls < 1) {
    throw new Error(
      `${runtime} consult did not call the Oraculum MCP consult tool.\n${consult.stdout}\n${consult.stderr}`,
    );
  }
  const unexpectedConsultCrowns = countToolCalls(runtime, consult.stdout + consult.stderr, "crown");
  if (unexpectedConsultCrowns > 0) {
    throw new Error(
      `${runtime} consult unexpectedly called the Oraculum MCP crown tool ${unexpectedConsultCrowns} time(s).\n${consult.stdout}\n${consult.stderr}`,
    );
  }

  const { runId } = await waitForCompletedRun(projectRoot, {
    label: `${runtime} consult`,
    timeoutMs: settleTimeoutMs,
  });

  const crownPrompt = scenario.gitBacked ? `orc crown ${branchName}` : "orc crown";
  const crown = await runHost(runtime, projectRoot, crownPrompt);
  const crownLogPath = join(evidenceRoot, `${runtime}-crown.jsonl`);
  await writeFile(crownLogPath, crown.stdout + crown.stderr, "utf8");
  const crownToolCalls = countToolCalls(runtime, crown.stdout + crown.stderr, "crown");
  if (crownToolCalls < 1) {
    throw new Error(
      `${runtime} crown did not call the Oraculum MCP crown tool.\n${crown.stdout}\n${crown.stderr}`,
    );
  }
  assertVerifiedCrownMaterialization(runtime, crown.stdout + crown.stderr);
  await waitForExportPlan(projectRoot, runId, {
    label: `${runtime} crown`,
    timeoutMs: settleTimeoutMs,
  });

  if (scenario.gitBacked) {
    const branch = (
      await runCommand("git", ["branch", "--show-current"], {
        cwd: projectRoot,
        label: `${runtime} current branch`,
        timeoutMs: 30_000,
      })
    ).stdout.trim();
    if (branch !== branchName) {
      throw new Error(`Expected ${runtime} branch ${branchName}, received ${branch}.`);
    }
  }

  const value = (
    await runCommand(
      process.execPath,
      ["-e", buildExactMessageCheckScript(scenario, expectedValue)],
      {
        cwd: projectRoot,
        label: `${runtime} import verification`,
        timeoutMs: 30_000,
      },
    )
  ).stdout.trim();
  if (value !== expectedValue) {
    throw new Error(`Expected ${runtime} message "${expectedValue}", received "${value}".`);
  }

  if (scenario.packageJson) {
    await runCommand("npm", ["test", "--", "--test-reporter=spec"], {
      cwd: projectRoot,
      label: `${runtime} npm test`,
      timeoutMs: 60_000,
    });
  }

  const finalizedManifest = JSON.parse(
    await readFile(join(projectRoot, ".oraculum", "runs", runId, "run.json"), "utf8"),
  );
  const exportedCandidateIds = Array.isArray(finalizedManifest.candidates)
    ? finalizedManifest.candidates
        .filter((candidate) => candidate?.status === "exported")
        .map((candidate) => candidate.id)
    : [];
  if (
    finalizedManifest.status !== "completed" ||
    finalizedManifest.agent !== candidateAgent ||
    finalizedManifest.candidateCount !== hostNativeCandidateCount ||
    exportedCandidateIds.length !== 1
  ) {
    throw new Error(
      [
        `Expected ${runtime} run ${runId} to be completed with one exported candidate.`,
        `agent=${finalizedManifest.agent} expectedAgent=${candidateAgent}`,
        `candidateCount=${finalizedManifest.candidateCount} expectedCandidateCount=${hostNativeCandidateCount}`,
        `exportedCandidateIds=${exportedCandidateIds.join(",") || "none"}`,
        JSON.stringify(finalizedManifest, null, 2),
      ].join("\n"),
    );
  }

  const exportPlan = JSON.parse(
    await readFile(
      join(projectRoot, ".oraculum", "runs", runId, "reports", "export-plan.json"),
      "utf8",
    ),
  );
  if (scenario.gitBacked) {
    if (exportPlan.mode !== "git-branch" || exportPlan.branchName !== branchName) {
      throw new Error(
        `${runtime} expected a git-branch export for ${scenario.id}, received ${JSON.stringify(exportPlan, null, 2)}.`,
      );
    }
  } else if (exportPlan.mode !== "workspace-sync") {
    throw new Error(
      `${runtime} expected a workspace-sync export for ${scenario.id}, received ${JSON.stringify(exportPlan, null, 2)}.`,
    );
  }

  return {
    runtime,
    scenario: scenario.id,
    runId,
    branchName: scenario.gitBacked ? branchName : "workspace-sync",
    value,
    candidateAgent,
    candidateCount: hostNativeCandidateCount,
    toolCalls: {
      consult: consultToolCalls,
      crown: crownToolCalls,
    },
  };
}

async function runHost(runtime, projectRoot, prompt) {
  if (runtime === "claude-code") {
    return runCommand(
      "claude",
      [
        "-p",
        "--permission-mode",
        "bypassPermissions",
        "--model",
        claudeModel,
        "--verbose",
        "--output-format",
        "stream-json",
        prompt,
      ],
      {
        cwd: projectRoot,
        label: `${runtime} ${prompt}`,
        timeoutMs,
        completeWhen: isClaudeStreamJsonComplete,
      },
    );
  }

  return runCommand(
    "codex",
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "-C", projectRoot, prompt],
    {
      cwd: projectRoot,
      label: `${runtime} ${prompt}`,
      timeoutMs,
    },
  );
}

async function createFixtureProject(projectRoot, scenario, expectedValue, candidateAgent) {
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

function resolveScenarios(input) {
  const definitions = new Map(
    [
      {
        id: "node-package",
        sourcePath: "src/message.js",
        gitBacked: true,
        packageJson: true,
      },
      {
        id: "package-free",
        sourcePath: "src/message.mjs",
        gitBacked: false,
        packageJson: false,
      },
    ].map((scenario) => [scenario.id, scenario]),
  );
  return input
    .split(",")
    .map((scenario) => scenario.trim())
    .filter((scenario) => scenario.length > 0)
    .map((scenario) => {
      const definition = definitions.get(scenario);
      if (!definition) {
        throw new Error(
          `Unsupported ORACULUM_HOST_NATIVE_SCENARIOS value "${scenario}". Use node-package and/or package-free.`,
        );
      }
      return definition;
    });
}

function buildExactMessageCheckScript(scenario, expectedValue) {
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

async function readLatestRunId(projectRoot) {
  const latest = JSON.parse(
    await readFile(join(projectRoot, ".oraculum", "latest-run.json"), "utf8"),
  );
  if (typeof latest.runId !== "string" || latest.runId.length === 0) {
    throw new Error(`latest-run.json does not contain a runId: ${JSON.stringify(latest)}`);
  }

  return latest.runId;
}

export async function waitForCompletedRun(projectRoot, options) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  let lastError = "latest-run.json was not written yet.";

  while (Date.now() < deadline) {
    try {
      const runId = await readLatestRunId(projectRoot);
      const runPath = join(projectRoot, ".oraculum", "runs", runId, "run.json");
      const manifest = JSON.parse(await readFile(runPath, "utf8"));
      if (manifest.status === "completed") {
        return { runId, manifest };
      }
      lastError = `run ${runId} is still ${manifest.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`${options.label} did not settle within ${options.timeoutMs}ms. ${lastError}`);
}

export async function waitForExportPlan(projectRoot, runId, options) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  const exportPlanPath = join(
    projectRoot,
    ".oraculum",
    "runs",
    runId,
    "reports",
    "export-plan.json",
  );
  const runPath = join(projectRoot, ".oraculum", "runs", runId, "run.json");
  let lastError = `export plan ${exportPlanPath} was not written yet.`;

  while (Date.now() < deadline) {
    try {
      await readFile(exportPlanPath, "utf8");
      const manifest = JSON.parse(await readFile(runPath, "utf8"));
      const exportedCandidateIds = Array.isArray(manifest.candidates)
        ? manifest.candidates.filter((candidate) => candidate?.status === "exported")
        : [];
      if (exportedCandidateIds.length > 0) {
        return;
      }
      lastError = `export plan exists, but run ${runId} has not recorded an exported candidate yet.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `${options.label} did not persist its export plan within ${options.timeoutMs}ms. ${lastError}`,
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function countToolCalls(runtime, output, command) {
  if (runtime === "claude-code") {
    return countHostToolUses(output, `mcp__plugin_oraculum_oraculum__oraculum_${command}`);
  }

  const parsed = countHostToolUses(output, `oraculum_${command}`);
  if (parsed > 0) {
    return parsed;
  }

  return countOccurrences(output, `mcp: oraculum/oraculum_${command} started`);
}

function countOccurrences(value, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next < 0) {
      return count;
    }
    count += 1;
    offset = next + needle.length;
  }
}

function assertVerifiedCrownMaterialization(runtime, output) {
  const materializations = collectVerifiedCrownMaterializations(output);
  const verified = materializations.some(
    (entry) =>
      entry?.materialization?.verified === true &&
      Array.isArray(entry.materialization.checks) &&
      entry.materialization.checks.length > 0 &&
      Number.isInteger(entry.materialization.changedPathCount) &&
      entry.materialization.changedPathCount > 0,
  );

  if (!verified) {
    throw new Error(
      `${runtime} crown did not return verified materialization evidence.\n${output}`,
    );
  }
}

function collectVerifiedCrownMaterializations(output) {
  const matches = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      collectCrownMaterializations(JSON.parse(trimmed), matches);
    } catch {
      // Host CLIs can mix JSONL with plain diagnostics; non-JSON lines are not response evidence.
    }
  }

  return matches;
}

function collectCrownMaterializations(value, matches) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"mode":"crown"')) {
      try {
        collectCrownMaterializations(JSON.parse(trimmed), matches);
      } catch {
        // Ignore non-JSON string payloads.
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCrownMaterializations(entry, matches);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (value.mode === "crown" && isObject(value.materialization)) {
    matches.push(value);
  }

  for (const child of Object.values(value)) {
    collectCrownMaterializations(child, matches);
  }
}

function countHostToolUses(output, toolName) {
  const toolUseIds = new Set();
  let anonymousToolUses = 0;

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      for (const toolUse of collectHostToolUses(JSON.parse(trimmed), toolName)) {
        if (toolUse.id) {
          toolUseIds.add(toolUse.id);
        } else {
          anonymousToolUses += 1;
        }
      }
    } catch {
      // Host CLIs can mix JSONL with plain diagnostics; non-JSON lines are not tool-use evidence.
    }
  }

  return toolUseIds.size + anonymousToolUses;
}

function collectHostToolUses(value, toolName, inheritedId = undefined) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectHostToolUses(entry, toolName, inheritedId));
  }

  if (!isObject(value)) {
    return [];
  }

  const localId = extractToolUseId(value) ?? inheritedId;
  const name = typeof value.name === "string" ? value.name : undefined;
  const tool = typeof value.tool === "string" ? value.tool : undefined;
  const type = typeof value.type === "string" ? value.type : "";
  const isClaudeToolUse = type === "tool_use" && name === toolName;
  const isCodexMcpToolUse = tool === toolName && isLikelyCodexToolUseType(type);
  const matches = isClaudeToolUse || isCodexMcpToolUse ? [{ id: localId }] : [];

  for (const child of Object.values(value)) {
    matches.push(...collectHostToolUses(child, toolName, localId));
  }

  return matches;
}

function extractToolUseId(value) {
  for (const key of ["id", "call_id", "callId", "tool_call_id", "toolCallId"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function isLikelyCodexToolUseType(type) {
  return type.length === 0 || /call|item|mcp|tool/iu.test(type);
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function assertRuntimes(values) {
  const allowed = new Set(["claude-code", "codex"]);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Unsupported host-native runtime "${value}". Use claude-code and/or codex.`);
    }
  }
}

function assertCandidateAgent(value) {
  const allowed = new Set(["claude-code", "codex", "host"]);
  if (!allowed.has(value)) {
    throw new Error(
      'Unsupported ORACULUM_HOST_NATIVE_AGENT value. Use "codex", "claude-code", or "host".',
    );
  }
}

function resolveCandidateAgent(runtime) {
  return candidateAgentInput === "host" ? runtime : candidateAgentInput;
}

function parseBoundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let closed = false;
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeoutId = setTimeout(() => {
      if (!closed) {
        timedOut = true;
        terminateChild(child);
      }
    }, options.timeoutMs).unref();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!settled && options.completeWhen?.(stdout, stderr)) {
        settled = true;
        clearTimeout(timeoutId);
        terminateChild(child);
        resolve({ stdout, stderr });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!settled && options.completeWhen?.(stdout, stderr)) {
        settled = true;
        clearTimeout(timeoutId);
        terminateChild(child);
        resolve({ stdout, stderr });
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Failed to start ${options.label}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeoutId);
      if (settled) {
        return;
      }
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            [
              `Command failed: ${options.label}`,
              `exitCode=${code ?? "null"} signal=${signal ?? "null"}`,
              timedOut ? `timedOut=true timeoutMs=${options.timeoutMs}` : "",
              stdout ? `stdout:\n${stdout}` : "",
              stderr ? `stderr:\n${stderr}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function isClaudeStreamJsonComplete(stdout, _stderr) {
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === "result") {
        return true;
      }
    } catch {
      // Ignore mixed plain-text diagnostics while scanning for the terminal JSON event.
    }
  }

  return false;
}

function terminateChild(child) {
  if (process.platform === "win32") {
    const pid = child.pid;
    if (!pid) {
      return;
    }
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 500).unref();
}

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
