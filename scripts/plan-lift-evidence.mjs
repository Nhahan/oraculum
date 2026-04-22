import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildFakeCodexSource } from "./plan-lift-evidence/fake-codex.mjs";
import { writeNodeBinary } from "./plan-lift-evidence/helpers.mjs";
import { scenarios } from "./plan-lift-evidence/scenarios.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distMcpToolsPath = join(repoRoot, "dist", "services", "mcp-tools.js");
const distPlanLiftHarnessPath = join(repoRoot, "dist", "services", "plan-lift-harness.js");
const distRunDomainPath = join(repoRoot, "dist", "domain", "run.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";

async function loadBuiltRuntime() {
  if (!existsSync(distMcpToolsPath)) {
    throw new Error("dist/services/mcp-tools.js is missing. Run `npm run build` first.");
  }
  if (!existsSync(distPlanLiftHarnessPath)) {
    throw new Error("dist/services/plan-lift-harness.js is missing. Run `npm run build` first.");
  }
  if (!existsSync(distRunDomainPath)) {
    throw new Error("dist/domain/run.js is missing. Run `npm run build` first.");
  }

  const [mcpTools, planLiftHarness, runDomain] = await Promise.all([
    import(pathToFileURL(distMcpToolsPath).href),
    import(pathToFileURL(distPlanLiftHarnessPath).href),
    import(pathToFileURL(distRunDomainPath).href),
  ]);

  return { mcpTools, planLiftHarness, runDomain };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFixture(root, scenario) {
  await mkdir(join(root, ".oraculum"), { recursive: true });
  await mkdir(join(root, "tasks"), { recursive: true });
  await writeFile(join(root, ".oraculum", "plan-lift-scenario.txt"), `${scenario.id}\n`, "utf8");
  await writeJson(join(root, "package.json"), {
    name: `plan-lift-${scenario.id}`,
    private: true,
    type: "module",
    packageManager: "npm@10.0.0",
  });
  await writeJson(join(root, ".oraculum", "config.json"), {
    version: 1,
    defaultAgent: "codex",
    defaultCandidates: 2,
  });
  await writeJson(join(root, ".oraculum", "advanced.json"), scenario.advancedConfig());
  for (const [relativePath, contents] of Object.entries(scenario.initialFiles())) {
    await mkdir(dirname(join(root, relativePath)), { recursive: true });
    await writeFile(join(root, relativePath), contents, "utf8");
  }
  if (typeof scenario.afterWrite === "function") {
    await scenario.afterWrite(root);
  }
  await writeJson(join(root, "tasks", "task.json"), scenario.taskPacket(root));
}

function patchEnv(pairs) {
  const previous = new Map();
  for (const [key, value] of Object.entries(pairs)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function getCandidateVerdictPath(root, runId, candidateId, roundId, oracleId) {
  return join(
    root,
    ".oraculum",
    "runs",
    runId,
    "candidates",
    candidateId,
    "verdicts",
    `${roundId}--${oracleId}.json`,
  );
}

function collectExecutedRepoOracleIds(root, manifest, expectedRepoOracles = []) {
  const executed = new Set();
  for (const candidate of manifest.candidates) {
    for (const oracle of expectedRepoOracles) {
      if (
        existsSync(
          getCandidateVerdictPath(root, manifest.id, candidate.id, oracle.roundId, oracle.id),
        )
      ) {
        executed.add(oracle.id);
      }
    }
  }
  return [...executed].sort();
}

async function readWinnerCriteria(artifacts) {
  const winnerSelectionPath = artifacts?.winnerSelectionPath;
  if (!winnerSelectionPath || !existsSync(winnerSelectionPath)) {
    return [];
  }
  const payload = JSON.parse(await readFile(winnerSelectionPath, "utf8"));
  return Array.isArray(payload.judgingCriteria) ? payload.judgingCriteria : [];
}

async function promoteScenarioPlanIfNeeded(scenario, consultationPlanPath, runDomain) {
  if (!scenario.buildComplexPlan) {
    return;
  }

  const currentPlan = runDomain.consultationPlanArtifactSchema.parse(
    JSON.parse(await readFile(consultationPlanPath, "utf8")),
  );
  const nextPlan = runDomain.consultationPlanArtifactSchema.parse(
    scenario.buildComplexPlan(currentPlan),
  );
  await writeJson(consultationPlanPath, nextPlan);
}

function candidateStatuses(manifest) {
  return Object.fromEntries(
    manifest.candidates.map((candidate) => [candidate.id, candidate.status]),
  );
}

function candidateRepairCounts(manifest) {
  return Object.fromEntries(
    manifest.candidates.map((candidate) => [candidate.id, candidate.repairCount ?? 0]),
  );
}

function classifyScenario({ direct, planned, scenario }) {
  const directWeakCandidateStatus = direct.candidateStatuses[scenario.weakCandidateId];
  const directQuality = direct.quality.score;
  const plannedQuality = planned.quality.score;

  if (!direct.crownVerified || !planned.crownVerified) {
    return "invalid";
  }
  if (plannedQuality > directQuality) {
    return "lift";
  }
  if (directWeakCandidateStatus === "eliminated") {
    return "pre-judge-elimination";
  }
  if (
    plannedQuality === directQuality &&
    planned.winner?.source !== direct.winner?.source &&
    planned.judgingCriteria.length > 0
  ) {
    return "contract-replay-without-lift";
  }
  return "parity";
}

function summarizeAggregate(results) {
  const counts = new Map();
  for (const result of results) {
    counts.set(result.classification, (counts.get(result.classification) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function runRoute(root, scenario, mode, mcpTools, runDomain) {
  const taskPath = join(root, "tasks", "task.json");
  if (mode === "direct") {
    const consult = await mcpTools.runConsultTool({
      cwd: root,
      taskInput: taskPath,
    });
    let crownVerified = false;
    let crownError;
    try {
      const crown = await mcpTools.runCrownTool({
        cwd: root,
        materializationLabel: `${scenario.id}-${mode}`,
      });
      crownVerified = crown.materialization.verified;
    } catch (error) {
      crownError = error instanceof Error ? error.message : String(error);
    }
    return {
      winner: consult.consultation.recommendedWinner ?? null,
      candidateStatuses: candidateStatuses(consult.consultation),
      repairCounts: candidateRepairCounts(consult.consultation),
      crownVerified,
      ...(crownError ? { crownError } : {}),
      executedRepoOracleIds: collectExecutedRepoOracleIds(
        root,
        consult.consultation,
        scenario.expectedRepoOracles,
      ),
      judgingCriteria: await readWinnerCriteria(consult.artifacts),
      quality: scenario.analyze(root),
    };
  }

  const plan = await mcpTools.runPlanTool({
    cwd: root,
    taskInput: taskPath,
  });
  await promoteScenarioPlanIfNeeded(scenario, plan.artifacts.consultationPlanPath, runDomain);
  const consult = await mcpTools.runConsultTool({
    cwd: root,
    taskInput: plan.artifacts.consultationPlanPath,
  });
  let crownVerified = false;
  let crownError;
  try {
    const crown = await mcpTools.runCrownTool({
      cwd: root,
      materializationLabel: `${scenario.id}-${mode}`,
    });
    crownVerified = crown.materialization.verified;
  } catch (error) {
    crownError = error instanceof Error ? error.message : String(error);
  }
  return {
    winner: consult.consultation.recommendedWinner ?? null,
    candidateStatuses: candidateStatuses(consult.consultation),
    repairCounts: candidateRepairCounts(consult.consultation),
    crownVerified,
    ...(crownError ? { crownError } : {}),
    executedRepoOracleIds: collectExecutedRepoOracleIds(
      root,
      consult.consultation,
      scenario.expectedRepoOracles,
    ),
    judgingCriteria: await readWinnerCriteria(consult.artifacts),
    quality: scenario.analyze(root),
  };
}

export async function runPlanLiftEvidence({ mcpTools, planLiftHarness, runDomain, scenarioIds }) {
  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-plan-lift-"));
  const fakeCodex = await writeNodeBinary(
    tempRoot,
    "fake-codex",
    buildFakeCodexSource(planLiftHarness),
  );
  const results = [];
  const selectedScenarios = scenarioIds
    ? (() => {
        const requestedIds = new Set(scenarioIds);
        const matchingScenarios = scenarios.filter((scenario) => requestedIds.has(scenario.id));
        if (matchingScenarios.length !== requestedIds.size) {
          const knownIds = new Set(matchingScenarios.map((scenario) => scenario.id));
          const missingIds = [...requestedIds].filter((scenarioId) => !knownIds.has(scenarioId));
          throw new Error(`Unknown plan-lift scenario ids: ${missingIds.join(", ")}`);
        }
        return matchingScenarios;
      })()
    : scenarios;

  const restoreEnv = patchEnv({ ORACULUM_CODEX_BIN: fakeCodex });
  try {
    for (const scenario of selectedScenarios) {
      const baseRoot = join(tempRoot, scenario.id, "base");
      const directRoot = join(tempRoot, scenario.id, "direct");
      const plannedRoot = join(tempRoot, scenario.id, "planned");
      await writeFixture(baseRoot, scenario);
      await cp(baseRoot, directRoot, { recursive: true });
      await cp(baseRoot, plannedRoot, { recursive: true });

      const [direct, planned] = await Promise.all([
        runRoute(directRoot, scenario, "direct", mcpTools, runDomain),
        runRoute(plannedRoot, scenario, "planned", mcpTools, runDomain),
      ]);
      results.push({
        id: scenario.id,
        description: scenario.description,
        classification: classifyScenario({ direct, planned, scenario }),
        direct,
        planned,
      });
    }

    return {
      tempRoot,
      aggregate: summarizeAggregate(results),
      results,
    };
  } finally {
    restoreEnv();
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const runtime = await loadBuiltRuntime();
  const report = await runPlanLiftEvidence(runtime);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
