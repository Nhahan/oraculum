import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { prepareScenario } from "./beta-evidence/fixtures.mjs";
import {
  buildInlineTaskText,
  buildScenarioSet,
  markerFileSegmentsForScenario,
  resolveEvidenceMode,
  taskInputEdgeCases,
} from "./beta-evidence/scenarios.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = join(repoRoot, "dist", "cli.js");
const distMcpToolsPath = join(repoRoot, "dist", "services", "mcp-tools.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const evidenceMode = resolveEvidenceMode();
const evidenceAdapterTimeoutMs = 60_000;
const evidenceScenarioIds = resolveScenarioIds();

async function main() {
  if (!existsSync(distCliPath) || !existsSync(distMcpToolsPath)) {
    throw new Error(
      `Built Oraculum artifacts were not found under dist. Run "npm run build" first.`,
    );
  }

  const scenarioRoot = await mkdtemp(join(tmpdir(), "oraculum-beta-evidence-"));
  const scenarios = buildScenarioSet(evidenceMode).filter(
    (scenario) => evidenceScenarioIds.length === 0 || evidenceScenarioIds.includes(scenario.id),
  );
  const startedAt = Date.now();
  const results = [];

  process.stdout.write(
    `Running ${scenarios.length} local dist evidence scenarios (${evidenceMode})...\n`,
  );

  for (const scenario of scenarios) {
    const workdir = join(scenarioRoot, scenario.id);
    const started = Date.now();

    try {
      await prepareScenario(workdir, scenario, {
        invocationCwdForScenario,
        runInitToolRequest,
        runOrThrow,
      });
      await executeScenario(workdir, scenario);
      const durationMs = Date.now() - started;
      results.push({ id: scenario.id, status: "passed", durationMs });
      process.stdout.write(`PASS ${scenario.id} (${durationMs}ms)\n`);
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const debug = await collectScenarioDebug(workdir);
      results.push({ id: scenario.id, status: "failed", durationMs, message, workdir });
      process.stdout.write(`FAIL ${scenario.id} (${durationMs}ms)\n`);
      process.stdout.write(`${indent(message)}\n`);
      if (debug) {
        process.stdout.write(`${indent(debug)}\n`);
      }
    }
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  const durationMs = Date.now() - startedAt;
  process.stdout.write(
    `\nEvidence summary: ${passed}/${results.length} scenarios passed in ${durationMs}ms.\n`,
  );

  if (failed > 0) {
    const failures = results.filter((result) => result.status === "failed");
    for (const failure of failures) {
      process.stdout.write(`- ${failure.id}: ${failure.message}\n`);
      if (failure.workdir) {
        process.stdout.write(`  workspace: ${failure.workdir}\n`);
      }
    }
    throw new Error(`Evidence matrix failed in ${failed} scenario(s).`);
  }

  if (!keepEvidence) {
    await rm(scenarioRoot, { recursive: true, force: true });
  } else {
    process.stdout.write(`Evidence workspaces preserved at ${scenarioRoot}\n`);
  }
}

async function executeScenario(workdir, scenario) {
  const env = {
    ...process.env,
    ...(scenario.packageManagerShimDir
      ? {
          PATH: `${scenario.packageManagerShimDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        }
      : {}),
    ...(scenario.agent === "codex"
      ? { ORACULUM_CODEX_BIN: scenario.fakeBinaryPath }
      : { ORACULUM_CLAUDE_BIN: scenario.fakeBinaryPath }),
  };

  const toolCwd = invocationCwdForScenario(workdir, scenario);
  const taskArgument = buildTaskArgument(scenario);

  if (scenario.kind === "draft" || scenario.kind === "filelike-inline-draft") {
    const draft = await runDraftToolRequest(
      {
        cwd: toolCwd,
        taskInput: taskArgument,
        agent: scenario.agent,
        candidates: 1,
      },
      { env },
    );
    assertContains(draft.stdout, "Drafted only.");
    const run = await readNewestRunManifest(workdir);
    assertEqual(run.status, "planned", `${scenario.id}: expected a planned consultation.`);
    assertEqual(
      run.profileSelection?.source,
      "fallback-detection",
      `${scenario.id}: draft should skip runtime profile selection.`,
    );
    if (scenario.kind === "filelike-inline-draft") {
      const normalizedSourcePath = run.taskPacket.sourcePath.replaceAll("\\", "/");
      assertEqual(
        run.taskPacket.sourceKind,
        "task-note",
        `${scenario.id}: file-like draft input should materialize as a generated task note.`,
      );
      assertContains(
        normalizedSourcePath,
        ".oraculum/tasks/",
        `${scenario.id}: file-like draft input should land under generated tasks.`,
      );
    }
    return;
  }

  const consult = await runConsultToolRequest(
    {
      cwd: toolCwd,
      taskInput: taskArgument,
      agent: scenario.agent,
      candidates: scenario.candidateCount,
      timeoutMs: scenario.timeoutMs ?? evidenceAdapterTimeoutMs,
    },
    { env },
  );
  assertContains(consult.stdout, "Consultation complete.");

  const run = await readLatestRunManifest(workdir);
  assertEqual(run.status, "completed", `${scenario.id}: expected a completed consultation.`);
  assertEqual(
    readValidationProfileId(run.profileSelection),
    scenario.profileId,
    `${scenario.id}: unexpected consultation profile.`,
  );

  if (scenario.kind === "happy") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to be recommended.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "single") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-01",
      `${scenario.id}: expected cand-01 to be recommended for single-candidate runs.`,
    );
    await assertHappyCrown(workdir, scenario, env, "cand-01");
    return;
  }

  if (scenario.kind === "no-finalist") {
    assertAbsent(
      run.recommendedWinner,
      `${scenario.id}: no-finalist should not recommend a winner.`,
    );
    assertEqual(
      run.candidates.some((candidate) => candidate.status === "promoted"),
      false,
      `${scenario.id}: no-finalist should not leave promoted candidates.`,
    );
    const verdict = await runVerdictToolRequest({ cwd: workdir }, { env });
    assertContains(verdict.stdout, "review why no candidate survived the oracle rounds");
    assertNotContains(verdict.stdout, "crown the recommended survivor");
    return;
  }

  if (scenario.kind === "runtime-missing") {
    assertAbsent(
      run.recommendedWinner,
      `${scenario.id}: missing runtime should not recommend a survivor.`,
    );
    assertEqual(
      run.candidates.every((candidate) => candidate.status === "eliminated"),
      true,
      `${scenario.id}: missing runtime should eliminate every candidate.`,
    );
    const verdict = await runVerdictToolRequest({ cwd: workdir }, { env });
    assertContains(verdict.stdout, "review why no candidate survived the oracle rounds");
    return;
  }

  if (scenario.kind === "abstain") {
    assertAbsent(run.recommendedWinner, `${scenario.id}: abstain should not recommend a winner.`);
    assertEqual(
      run.candidates.some((candidate) => candidate.status === "promoted"),
      true,
      `${scenario.id}: abstain should still leave survivors.`,
    );
    const verdict = await runVerdictToolRequest({ cwd: workdir }, { env });
    assertContains(
      verdict.stdout,
      "The shared `orc crown` path only crowns a recommended survivor.",
    );
    const crown = await runCrownToolRequest(
      {
        cwd: workdir,
        candidateId: "cand-02",
        branchName: buildBranchName(scenario, "manual"),
      },
      { env },
    );
    assertContains(crown.stdout, "Crowned cand-02");
    await assertTargetFileContains(workdir, scenario, "cand-02");
    return;
  }

  if (scenario.kind === "advanced-override") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to survive the explicit override scenario.`,
    );
    const verdictFiles = await readdir(
      join(workdir, ".oraculum", "runs", run.id, "candidates", "cand-02", "verdicts"),
    );
    assertContains(
      verdictFiles.join(","),
      "impact--custom-impact.json",
      `${scenario.id}: explicit advanced oracle should execute.`,
    );
    const generatedOracleIds =
      scenario.repoKind === "frontend"
        ? ["impact--build-impact.json", "deep--e2e-deep.json"]
        : scenario.repoKind === "migration"
          ? ["impact--migration-impact.json", "deep--migration-drift-deep.json"]
          : ["impact--unit-impact.json", "deep--full-suite-deep.json"];
    for (const generated of generatedOracleIds) {
      assertEqual(
        verdictFiles.includes(generated),
        false,
        `${scenario.id}: explicit advanced oracles should override inferred profile oracles (${generated}).`,
      );
    }
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "manual-crown") {
    assertAbsent(
      run.recommendedWinner,
      `${scenario.id}: manual-crown setup should abstain automatically.`,
    );
    const firstRunId = run.id;
    const runtimeToolRoot = join(workdir, ".oraculum", "runtime-tools");
    await mkdir(runtimeToolRoot, { recursive: true });
    const secondBinaryPath =
      scenario.agent === "codex"
        ? await writeNodeBinary(
            runtimeToolRoot,
            "manual-crown-followup-codex",
            buildFakeRuntimeSource({ ...scenario, kind: "happy" }),
          )
        : await writeNodeBinary(
            runtimeToolRoot,
            "manual-crown-followup-claude",
            buildFakeRuntimeSource({ ...scenario, kind: "happy" }),
          );
    const secondEnv = {
      ...env,
      ...(scenario.agent === "codex"
        ? { ORACULUM_CODEX_BIN: secondBinaryPath }
        : { ORACULUM_CLAUDE_BIN: secondBinaryPath }),
    };
    const followup = await runConsultToolRequest(
      {
        cwd: workdir,
        taskInput: buildInlineTaskText(scenario.repoKind),
        agent: scenario.agent,
        candidates: 2,
        timeoutMs: evidenceAdapterTimeoutMs,
      },
      { env: secondEnv },
    );
    assertContains(followup.stdout, "Consultation complete.");
    const crown = await runCrownToolRequest(
      {
        cwd: workdir,
        candidateId: scenario.manualCandidateId,
        consultationId: firstRunId,
        branchName: buildBranchName(scenario, scenario.manualCandidateId),
      },
      { env },
    );
    assertContains(crown.stdout, `Crowned ${scenario.manualCandidateId}`);
    await assertTargetFileContains(workdir, scenario, scenario.manualCandidateId);
    return;
  }

  if (scenario.kind === "repair") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-01",
      `${scenario.id}: repair flow should still recommend a survivor.`,
    );
    const candidate = run.candidates.find((entry) => entry.id === "cand-01");
    if (!candidate) {
      throw new Error(`${scenario.id}: missing cand-01 manifest.`);
    }
    assertEqual(candidate.repairCount > 0, true, `${scenario.id}: repairCount should be > 0.`);
    assertContains(candidate.repairedRounds.join(","), "impact");
    await assertHappyCrown(workdir, scenario, env, "cand-01");
    return;
  }

  if (scenario.kind === "stale-base") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: stale-base setup should still have a recommendation.`,
    );
    await writeFile(join(workdir, "post-consult-change.txt"), "moved head\n", "utf8");
    runOrThrow("git", ["add", "post-consult-change.txt"], { cwd: workdir });
    runOrThrow("git", ["commit", "-m", "move head"], { cwd: workdir });
    const crown = await runCrownToolRequest(
      {
        cwd: workdir,
        branchName: buildBranchName(scenario, "stale"),
      },
      {
        env,
        allowFailure: true,
      },
    );
    assertContains(crown.stderr + crown.stdout, "recorded base revision");
    return;
  }

  if (scenario.kind === "branch-exists") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: branch-exists setup should still have a recommendation.`,
    );
    const branchName = buildBranchName(scenario, "exists");
    runOrThrow("git", ["checkout", "-b", branchName], { cwd: workdir });
    runOrThrow("git", ["checkout", "-"], { cwd: workdir });
    const crown = await runCrownToolRequest(
      {
        cwd: workdir,
        branchName,
      },
      {
        env,
        allowFailure: true,
      },
    );
    assertContains(crown.stderr + crown.stdout, `Branch "${branchName}" already exists.`);
    return;
  }

  if (scenario.kind === "hung-runtime") {
    assertAbsent(
      run.recommendedWinner,
      `${scenario.id}: hung runtime should not recommend a survivor.`,
    );
    assertEqual(
      run.candidates.every((candidate) => candidate.status === "eliminated"),
      true,
      `${scenario.id}: hung runtime should eliminate every candidate.`,
    );
    const verdict = await runVerdictToolRequest({ cwd: workdir }, { env });
    assertContains(verdict.stdout, "review why no candidate survived the oracle rounds");
    return;
  }

  if (scenario.kind === "monorepo") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to be recommended for the monorepo scenario.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "nested-workspace") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to be recommended for the nested workspace scenario.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "subdirectory-invocation") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to be recommended for the subdirectory invocation scenario.`,
    );
    await assertSubdirectoryInvocation(workdir, scenario, run, env);
    return;
  }

  if (scenario.kind === "timed-out-oracle") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-01",
      `${scenario.id}: expected cand-01 to survive the signal-only timed-out oracle.`,
    );
    await assertTimedOutOracleCleanup(workdir, scenario, run, env);
    return;
  }

  if (scenario.kind === "migration-missing-capability") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected a survivor even when migration validation is missing.`,
    );
    assertContains(
      readValidationGaps(run.profileSelection).join("\n"),
      "No repo-local validation command was detected.",
    );
    const profileArtifact = await readProfileSelectionArtifact(workdir, run.id);
    const skippedCommandCandidates = JSON.stringify(
      profileArtifact.signals?.skippedCommandCandidates ?? [],
    );
    assertContains(skippedCommandCandidates, "migration-impact");
    assertContains(skippedCommandCandidates, "missing-explicit-command");
    assertContains(skippedCommandCandidates, "migration-tool:alembic");
    const verdict = await runVerdictToolRequest({ cwd: workdir }, { env });
    assertContains(verdict.stdout, "Validation gaps from the selected posture:");
    assertContains(verdict.stdout, "No repo-local validation command was detected.");
    assertContains(verdict.stdout, "Skipped validation posture commands:");
    assertContains(verdict.stdout, "migration-impact: missing-explicit-command");
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "migration-explicit-oracle") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected a survivor with an explicit migration oracle.`,
    );
    assertEqual(
      readValidationGaps(run.profileSelection).length,
      0,
      `${scenario.id}: explicit advanced migration oracle should clear profile validation gaps.`,
    );
    const verdictFiles = await readdir(
      join(workdir, ".oraculum", "runs", run.id, "candidates", "cand-02", "verdicts"),
    );
    assertContains(
      verdictFiles.join(","),
      "impact--migration-explicit-impact.json",
      `${scenario.id}: explicit Alembic migration oracle should execute.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "task-input-edge") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected a survivor for the task-input edge scenario.`,
    );
    assertTaskInputEdge(workdir, scenario, run);
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  if (scenario.kind === "large-diff") {
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected cand-02 to be recommended for the large diff scenario.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    await assertLargeDiffMaterialized(workdir, "cand-02");
    return;
  }

  if (scenario.kind === "filelike-inline-consult") {
    const normalizedSourcePath = run.taskPacket.sourcePath.replaceAll("\\", "/");
    assertEqual(
      run.taskPacket.sourceKind,
      "task-note",
      `${scenario.id}: file-like text should be materialized as a generated task note.`,
    );
    assertContains(
      normalizedSourcePath,
      ".oraculum/tasks/",
      `${scenario.id}: file-like text should land under generated tasks.`,
    );
    assertEqual(
      run.recommendedWinner?.candidateId,
      "cand-02",
      `${scenario.id}: expected a normal recommendation from file-like inline consultation.`,
    );
    await assertHappyCrown(workdir, scenario, env);
    return;
  }

  throw new Error(`${scenario.id}: unsupported scenario kind ${scenario.kind}`);
}

async function assertHappyCrown(workdir, scenario, env, candidateId = "cand-02") {
  const branchName = buildBranchName(scenario, "winner");
  const toolCwd = invocationCwdForScenario(workdir, scenario);
  const crown = await runCrownToolRequest(
    {
      cwd: toolCwd,
      ...(candidateId === "cand-02" ? {} : { candidateId }),
      ...(scenario.workspaceMode === "git" ? { branchName } : {}),
    },
    { env },
  );
  assertContains(crown.stdout, `Crowned ${candidateId}`);
  await assertTargetFileContains(workdir, scenario, candidateId);

  if (scenario.workspaceMode === "git") {
    const branch = runOrThrow("git", ["branch", "--show-current"], { cwd: workdir }).stdout.trim();
    assertEqual(branch, branchName, `${scenario.id}: expected crowned git branch.`);
  }
}

function invocationCwdForScenario(workdir, scenario) {
  if (scenario.kind === "subdirectory-invocation") {
    return join(workdir, "packages", "app");
  }

  return workdir;
}

function buildTaskArgument(scenario) {
  if (scenario.taskInputMode === "inline") {
    return buildInlineTaskText(scenario.repoKind);
  }

  if (scenario.taskInputMode === "filelike-inline") {
    return "fix/session-loss-on-refresh";
  }

  const edgeCase = taskInputEdgeCases[scenario.taskInputMode];
  if (edgeCase) {
    return join(...edgeCase.pathSegments);
  }

  return join("tasks", `${scenario.repoKind}.md`);
}

function assertTaskInputEdge(workdir, scenario, run) {
  const edgeCase = taskInputEdgeCases[scenario.taskInputMode];
  if (!edgeCase) {
    throw new Error(`${scenario.id}: unknown task-input edge mode ${scenario.taskInputMode}`);
  }

  const normalizedSourcePath = run.taskPacket.sourcePath.replaceAll("\\", "/");
  const expectedPathSuffix = edgeCase.pathSegments.join("/");
  assertEqual(
    run.taskPacket.sourceKind,
    "task-note",
    `${scenario.id}: edge task input should materialize as a task note.`,
  );
  assertContains(
    normalizedSourcePath,
    expectedPathSuffix,
    `${scenario.id}: edge task input should preserve the requested source path.`,
  );
  assertNotContains(
    normalizedSourcePath,
    ".oraculum/tasks/",
    `${scenario.id}: existing edge task input paths should not be rewritten into generated inline notes.`,
  );
  assertEqual(
    normalizedSourcePath.startsWith(workdir.replaceAll("\\", "/")),
    true,
    `${scenario.id}: edge task input should resolve inside the scenario workspace.`,
  );
}

async function assertSubdirectoryInvocation(workdir, scenario, run, env) {
  const toolCwd = invocationCwdForScenario(workdir, scenario);
  const normalizedTaskPath = run.taskPath.replaceAll("\\", "/");
  assertEqual(
    normalizedTaskPath,
    join(workdir, "tasks", `${scenario.repoKind}.md`).replaceAll("\\", "/"),
    `${scenario.id}: nested invocation should fall back to the initialized root task file.`,
  );
  assertEqual(
    existsSync(join(workdir, ".oraculum", "latest-run.json")),
    true,
    `${scenario.id}: latest run state should be written at the initialized root.`,
  );
  assertEqual(
    existsSync(join(toolCwd, ".oraculum")),
    false,
    `${scenario.id}: nested invocation must not create a stray .oraculum directory.`,
  );
  const verdict = await runVerdictToolRequest({ cwd: toolCwd }, { env });
  assertContains(
    verdict.stdout,
    "crown the recommended survivor",
    `${scenario.id}: nested verdict should resolve the root latest run.`,
  );
  await assertHappyCrown(workdir, scenario, env);
  assertEqual(
    existsSync(join(toolCwd, ".oraculum")),
    false,
    `${scenario.id}: nested crown must not create a stray .oraculum directory.`,
  );
}

async function assertTimedOutOracleCleanup(workdir, scenario, run, env) {
  const markerPath = join(workdir, "oracle-timeout-child-survived.txt");
  const verdict = JSON.parse(
    await readFile(
      join(
        workdir,
        ".oraculum",
        "runs",
        run.id,
        "candidates",
        "cand-01",
        "verdicts",
        "impact--timeout-child-cleanup.json",
      ),
      "utf8",
    ),
  );
  assertEqual(
    verdict.status,
    "pass",
    `${scenario.id}: signal-only timeout oracle should not eliminate the candidate.`,
  );
  assertEqual(
    verdict.severity,
    "warning",
    `${scenario.id}: timed-out signal oracle should remain visible as a warning.`,
  );
  assertContains(
    verdict.summary,
    "timed out",
    `${scenario.id}: timed-out oracle should explain the timeout in the verdict.`,
  );
  assertContains(
    verdict.witnesses?.[0]?.detail ?? "",
    "The command timed out.",
    `${scenario.id}: timed-out oracle witness should record timeout detail.`,
  );
  await new Promise((resolve) => setTimeout(resolve, 900));
  assertEqual(
    existsSync(markerPath),
    false,
    `${scenario.id}: timed-out oracle child process should not survive long enough to write its marker.`,
  );
  await assertHappyCrown(workdir, scenario, env, "cand-01");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assertEqual(
    existsSync(markerPath),
    false,
    `${scenario.id}: timed-out oracle child process should remain absent after crown.`,
  );
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let cachedMcpToolsModule;

async function loadDistMcpTools() {
  if (!cachedMcpToolsModule) {
    cachedMcpToolsModule = import(pathToFileURL(distMcpToolsPath).href);
  }

  return cachedMcpToolsModule;
}

async function runInitToolRequest(request, options = {}) {
  const module = await loadDistMcpTools();
  return invokeTool(
    options.env,
    async () => {
      const response = await module.runInitTool(request);
      return `Initialized Oraculum in ${response.initialization.projectRoot}\n`;
    },
    options.allowFailure,
  );
}

async function runConsultToolRequest(request, options = {}) {
  const module = await loadDistMcpTools();
  return invokeTool(
    options.env,
    async () => {
      const response = await module.runConsultTool(request);
      return `Consultation complete.\n${response.summary}`;
    },
    options.allowFailure,
  );
}

async function runDraftToolRequest(request, options = {}) {
  const module = await loadDistMcpTools();
  return invokeTool(
    options.env,
    async () => {
      const response = await module.runDraftTool(request);
      return `Drafted only. Execution was skipped because the draft command was requested.\n${response.summary}`;
    },
    options.allowFailure,
  );
}

async function runVerdictToolRequest(request, options = {}) {
  const module = await loadDistMcpTools();
  return invokeTool(
    options.env,
    async () => {
      const response = await module.runVerdictTool(request);
      return response.summary;
    },
    options.allowFailure,
  );
}

async function runCrownToolRequest(request, options = {}) {
  const module = await loadDistMcpTools();
  return invokeTool(
    options.env,
    async () => {
      const response = await module.runCrownTool(request);
      return [
        `Crowned ${response.plan.winnerId}`,
        `Consultation: ${response.plan.runId}`,
        `Branch: ${response.plan.branchName}`,
        `Crowning record: ${response.recordPath}`,
      ].join("\n");
    },
    options.allowFailure,
  );
}

async function invokeTool(envPatch, action, allowFailure = false) {
  const restoreEnv = patchEnv(envPatch);

  try {
    const stdout = await action();
    return {
      status: 0,
      stdout,
      stderr: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!allowFailure) {
      throw new Error(message);
    }

    return {
      status: 1,
      stdout: "",
      stderr: message,
    };
  } finally {
    restoreEnv();
  }
}

function patchEnv(envPatch = {}) {
  const keys = Object.keys(envPatch);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(envPatch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function readLatestRunManifest(root) {
  const latestRunState = JSON.parse(
    await readFile(join(root, ".oraculum", "latest-run.json"), "utf8"),
  );
  return JSON.parse(
    await readFile(join(root, ".oraculum", "runs", latestRunState.runId, "run.json"), "utf8"),
  );
}

async function readNewestRunManifest(root) {
  const runsDir = join(root, ".oraculum", "runs");
  const entries = (await readdir(runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const runId = entries[0];
  if (!runId) {
    throw new Error(`No consultation artifacts were created under ${runsDir}.`);
  }

  return JSON.parse(await readFile(join(runsDir, runId, "run.json"), "utf8"));
}

async function readProfileSelectionArtifact(root, runId) {
  return JSON.parse(
    await readFile(
      join(root, ".oraculum", "runs", runId, "reports", "profile-selection.json"),
      "utf8",
    ),
  );
}

async function collectScenarioDebug(root) {
  try {
    const run = await readLatestRunManifest(root);
    const lines = [
      `run=${run.id} status=${run.status} profile=${readValidationProfileId(run.profileSelection) ?? "none"} recommendation=${run.recommendedWinner?.candidateId ?? "none"}`,
    ];

    for (const candidate of run.candidates) {
      lines.push(
        `candidate ${candidate.id}: status=${candidate.status} repairs=${candidate.repairCount} repairedRounds=${candidate.repairedRounds.join(",") || "-"}`,
      );
      const verdictDir = join(
        root,
        ".oraculum",
        "runs",
        run.id,
        "candidates",
        candidate.id,
        "verdicts",
      );
      if (!existsSync(verdictDir)) {
        continue;
      }
      const verdictFiles = (await readdir(verdictDir))
        .filter((entry) => entry.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
      for (const verdictFile of verdictFiles) {
        const verdict = JSON.parse(await readFile(join(verdictDir, verdictFile), "utf8"));
        lines.push(`  verdict ${verdictFile}: status=${verdict.status} oracle=${verdict.oracleId}`);
      }
    }

    return lines.join("\n");
  } catch {
    return undefined;
  }
}

async function assertTargetFileContains(root, scenario, candidateId) {
  const file = targetFileForScenario(root, scenario);
  const contents = await readFile(file, "utf8");
  assertContains(contents, candidateId);
}

function readValidationProfileId(profileSelection) {
  if (!profileSelection || typeof profileSelection !== "object") {
    return undefined;
  }

  return (
    (typeof profileSelection.validationProfileId === "string"
      ? profileSelection.validationProfileId
      : undefined) ??
    (typeof profileSelection.profileId === "string" ? profileSelection.profileId : undefined)
  );
}

function readValidationGaps(profileSelection) {
  if (!profileSelection || typeof profileSelection !== "object") {
    return [];
  }

  if (Array.isArray(profileSelection.validationGaps)) {
    return profileSelection.validationGaps;
  }

  if (Array.isArray(profileSelection.missingCapabilities)) {
    return profileSelection.missingCapabilities;
  }

  return [];
}

function resolveScenarioIds() {
  const scenarioArgument = process.argv.find((argument) => argument.startsWith("--scenario="));
  if (!scenarioArgument) {
    return [];
  }

  return scenarioArgument
    .slice("--scenario=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function targetFileForScenario(root, scenario) {
  const markerFileSegments = markerFileSegmentsForScenario(scenario.repoKind);
  if (markerFileSegments) {
    return join(root, ...markerFileSegments);
  }
  if (scenario.repoKind === "monorepo") {
    return join(root, "packages", "app", "src", "index.js");
  }
  if (scenario.repoKind === "frontend") {
    return join(root, "src", "page.js");
  }
  if (scenario.repoKind === "migration") {
    return join(root, "prisma", "schema.prisma");
  }
  if (scenario.repoKind === "docs") {
    return join(root, "docs", "report.md");
  }
  if (scenario.repoKind === "service") {
    return join(root, "src", "server.js");
  }
  return join(root, "src", "index.js");
}

async function assertPathPresence(path, shouldExist) {
  const present = existsSync(path);
  if (present !== shouldExist) {
    throw new Error(
      shouldExist ? `Expected path to exist: ${path}` : `Expected path to be absent: ${path}`,
    );
  }
}

async function assertLargeDiffMaterialized(root, candidateId) {
  await assertPathPresence(join(root, "src", "tree", `renamed-${candidateId}.txt`), true);
  await assertPathPresence(join(root, "src", "tree", "rename-me.txt"), false);
  await assertPathPresence(join(root, "src", "tree", "delete-me.txt"), false);
  const generated = await readFile(
    join(root, "src", "tree", "nested", `generated-${candidateId}.txt`),
    "utf8",
  );
  assertContains(generated, candidateId);
}

function buildBranchName(scenario, suffix) {
  return `fix/${scenario.repoKind}-${scenario.agent.replaceAll("-code", "")}-${suffix}`;
}

function assertContains(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(message ?? `Expected output to contain "${expected}".\nReceived:\n${value}`);
  }
}

function assertNotContains(value, unexpected, message) {
  if (value.includes(unexpected)) {
    throw new Error(
      message ?? `Expected output not to contain "${unexpected}".\nReceived:\n${value}`,
    );
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message ?? `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertAbsent(value, message) {
  if (value !== undefined) {
    throw new Error(message ?? `Expected value to be absent, received ${JSON.stringify(value)}.`);
  }
}

function indent(value) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
