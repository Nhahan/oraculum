import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const timeoutMs = Number.parseInt(process.env.ORACULUM_HOST_NATIVE_TIMEOUT_MS ?? "300000", 10);
const claudeModel = process.env.ORACULUM_HOST_NATIVE_CLAUDE_MODEL ?? "sonnet";
const runtimeInput = process.env.ORACULUM_HOST_NATIVE_RUNTIMES ?? "claude-code,codex";
const candidateAgentInput = process.env.ORACULUM_HOST_NATIVE_AGENT ?? "host";
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
      results.push(await runRuntimeSmoke(tempRoot, runtime));
    }

    for (const result of results) {
      process.stdout.write(
        `${[
          `Host-native smoke passed for ${result.runtime}.`,
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
    [join(repoRoot, "dist", "cli.js"), "setup", "--runtime", runtime, "--scope", "user"],
    {
      cwd: repoRoot,
      label: `setup ${runtime}`,
      timeoutMs,
    },
  );
}

async function runRuntimeSmoke(tempRoot, runtime) {
  const projectRoot = join(tempRoot, `${runtime}-project`);
  const expectedValue = `hello from ${runtime} host-native smoke`;
  const branchName = `fix/${runtime}-host-native-smoke`;
  const candidateAgent = resolveCandidateAgent(runtime);
  await createFixtureProject(projectRoot, expectedValue, candidateAgent);

  const consultPrompt = `orc consult "Change src/message.js so message() returns exactly ${JSON.stringify(expectedValue)}. Keep the patch minimal. Do not edit tests or .oraculum configuration."`;
  const consult = await runHost(runtime, projectRoot, consultPrompt);
  const consultLogPath = join(projectRoot, `${runtime}-consult.jsonl`);
  await writeFile(consultLogPath, consult.stdout + consult.stderr, "utf8");
  const consultToolCalls = countToolCalls(runtime, consult.stdout + consult.stderr, "consult");
  if (consultToolCalls < 1) {
    throw new Error(
      `${runtime} consult did not call the Oraculum MCP consult tool.\n${consult.stdout}\n${consult.stderr}`,
    );
  }

  const runId = await readLatestRunId(projectRoot);

  const crown = await runHost(runtime, projectRoot, `orc crown ${branchName}`);
  const crownLogPath = join(projectRoot, `${runtime}-crown.jsonl`);
  await writeFile(crownLogPath, crown.stdout + crown.stderr, "utf8");
  const crownToolCalls = countToolCalls(runtime, crown.stdout + crown.stderr, "crown");
  if (crownToolCalls < 1) {
    throw new Error(
      `${runtime} crown did not call the Oraculum MCP crown tool.\n${crown.stdout}\n${crown.stderr}`,
    );
  }
  assertVerifiedCrownMaterialization(runtime, crown.stdout + crown.stderr);

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

  const value = (
    await runCommand(
      process.execPath,
      ["-e", "import('./src/message.js').then((module) => console.log(module.message()))"],
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

  await runCommand("npm", ["test", "--", "--test-reporter=spec"], {
    cwd: projectRoot,
    label: `${runtime} npm test`,
    timeoutMs: 60_000,
  });

  const manifest = JSON.parse(
    await readFile(join(projectRoot, ".oraculum", "runs", runId, "run.json"), "utf8"),
  );
  const exportedCandidateIds = Array.isArray(manifest.candidates)
    ? manifest.candidates
        .filter((candidate) => candidate?.status === "exported")
        .map((candidate) => candidate.id)
    : [];
  if (
    manifest.status !== "completed" ||
    manifest.agent !== candidateAgent ||
    manifest.candidateCount !== hostNativeCandidateCount ||
    exportedCandidateIds.length !== 1
  ) {
    throw new Error(
      [
        `Expected ${runtime} run ${runId} to be completed with one exported candidate.`,
        `agent=${manifest.agent} expectedAgent=${candidateAgent}`,
        `candidateCount=${manifest.candidateCount} expectedCandidateCount=${hostNativeCandidateCount}`,
        `exportedCandidateIds=${exportedCandidateIds.join(",") || "none"}`,
        JSON.stringify(manifest, null, 2),
      ].join("\n"),
    );
  }

  return {
    runtime,
    runId,
    branchName,
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

async function createFixtureProject(projectRoot, expectedValue, candidateAgent) {
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(join(projectRoot, "test"), { recursive: true });
  await mkdir(join(projectRoot, ".oraculum"), { recursive: true });
  await writeFile(
    join(projectRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "oraculum-host-native-smoke",
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
  await writeFile(
    join(projectRoot, "src", "message.js"),
    'export function message() {\n  return "before";\n}\n',
    "utf8",
  );
  await writeFile(
    join(projectRoot, "test", "message.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { message } from "../src/message.js";',
      "",
      'test("message returns the requested literal", () => {',
      `  assert.equal(message(), ${JSON.stringify(expectedValue)});`,
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
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
            args: [
              "-e",
              [
                `const expected = ${JSON.stringify(expectedValue)};`,
                "import('./src/message.js').then((module) => {",
                "  const actual = module.message();",
                "  if (actual !== expected) {",
                "    console.error('Expected ' + expected + ', received ' + actual);",
                "    process.exit(1);",
                "  }",
                "});",
              ].join("\n"),
            ],
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

async function readLatestRunId(projectRoot) {
  const latest = JSON.parse(
    await readFile(join(projectRoot, ".oraculum", "latest-run.json"), "utf8"),
  );
  if (typeof latest.runId !== "string" || latest.runId.length === 0) {
    throw new Error(`latest-run.json does not contain a runId: ${JSON.stringify(latest)}`);
  }

  return latest.runId;
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
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to start ${options.label}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeoutId);
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
