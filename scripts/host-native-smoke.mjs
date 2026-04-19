import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExactMessageCheckScript,
  createFixtureProject,
} from "./host-native-smoke/fixture.mjs";
import {
  assertVerifiedCrownMaterialization,
  countToolCalls,
} from "./host-native-smoke/parsing.mjs";
import {
  readLatestRunIdIfPresent,
  waitForCompletedRun,
  waitForExportPlan,
  waitForNextCompletedRun,
} from "./host-native-smoke/polling.mjs";
import { isClaudeStreamJsonComplete, runCommand } from "./host-native-smoke/process.mjs";
import {
  assertCandidateAgent,
  assertRuntimes,
  parseBoundedInteger,
  resolveCandidateAgent,
  resolveScenarios,
} from "./host-native-smoke/scenarios.mjs";

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
    throw new Error("dist/cli.js is missing. Run `npm run build` before launch smoke.");
  }

  if (!skipSetup) {
    for (const runtime of runtimes) {
      await setupRuntime(runtime);
    }
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-launch-smoke-"));
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
          `Launch smoke passed for ${result.runtime}.`,
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
      process.stdout.write(`Launch smoke workspace preserved at ${tempRoot}\n`);
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
  const expectedValue = `hello from ${runtime} ${scenario.id} launch smoke`;
  const branchName = `fix/${runtime}-${scenario.id}-launch-smoke`;
  const candidateAgent = resolveCandidateAgent(candidateAgentInput, runtime);
  await createFixtureProject(
    projectRoot,
    scenario,
    expectedValue,
    candidateAgent,
    hostNativeCandidateCount,
    runCommand,
  );
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

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

export {
  readLatestRunIdIfPresent,
  waitForCompletedRun,
  waitForExportPlan,
  waitForNextCompletedRun,
};
