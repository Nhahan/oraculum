import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = join(repoRoot, "dist", "cli.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const evidenceMode = resolveEvidenceMode();

const repoKinds = ["library", "frontend", "migration", "plain"];
const agents = ["codex", "claude-code"];
const workspaceModes = ["git", "copy"];
const packageManagers = ["pnpm", "yarn", "bun"];

function resolveEvidenceMode() {
  const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
  if (modeArgument) {
    return modeArgument.slice("--mode=".length);
  }
  return process.env.ORACULUM_EVIDENCE_MODE ?? "matrix";
}

async function main() {
  if (!existsSync(distCliPath)) {
    throw new Error(`dist CLI not found at ${distCliPath}. Run "npm run build" first.`);
  }

  const scenarioRoot = await mkdtemp(join(tmpdir(), "oraculum-beta-evidence-"));
  const scenarios = buildScenarioSet(evidenceMode);
  const startedAt = Date.now();
  const results = [];

  process.stdout.write(
    `Running ${scenarios.length} local dist evidence scenarios (${evidenceMode})...\n`,
  );

  for (const scenario of scenarios) {
    const workdir = join(scenarioRoot, scenario.id);
    const started = Date.now();

    try {
      await prepareScenario(workdir, scenario);
      await executeScenario(workdir, scenario);
      const durationMs = Date.now() - started;
      results.push({ id: scenario.id, status: "passed", durationMs });
      process.stdout.write(`PASS ${scenario.id} (${durationMs}ms)\n`);
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: scenario.id, status: "failed", durationMs, message, workdir });
      process.stdout.write(`FAIL ${scenario.id} (${durationMs}ms)\n`);
      process.stdout.write(`${indent(message)}\n`);
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

function buildScenarioSet(mode) {
  if (mode === "corpus") {
    return buildCorpusScenarios();
  }
  if (mode === "all") {
    return [...buildScenarioMatrix(), ...buildCorpusScenarios()];
  }
  return buildScenarioMatrix();
}

function buildScenarioMatrix() {
  const scenarios = [];

  for (const repoKind of repoKinds) {
    for (const agent of agents) {
      for (const workspaceMode of workspaceModes) {
        scenarios.push(
          createScenario({
            kind: "happy",
            repoKind,
            agent,
            workspaceMode,
          }),
        );
        scenarios.push(
          createScenario({
            kind: "no-finalist",
            repoKind,
            agent,
            workspaceMode,
          }),
        );
      }
    }
  }

  for (const repoKind of ["library", "frontend"]) {
    for (const agent of agents) {
      for (const workspaceMode of workspaceModes) {
        scenarios.push(
          createScenario({
            kind: "abstain",
            repoKind,
            agent,
            workspaceMode,
          }),
        );
      }
    }
  }

  for (const repoKind of ["library", "frontend", "migration"]) {
    for (const agent of agents) {
      scenarios.push(
        createScenario({
          kind: "repair",
          repoKind,
          agent,
          workspaceMode: "git",
        }),
      );
      scenarios.push(
        createScenario({
          kind: "stale-base",
          repoKind,
          agent,
          workspaceMode: "git",
        }),
      );
      scenarios.push(
        createScenario({
          kind: "branch-exists",
          repoKind,
          agent,
          workspaceMode: "git",
        }),
      );
    }
  }

  for (const repoKind of repoKinds) {
    scenarios.push(
      createScenario({
        kind: "draft",
        repoKind,
        agent: "codex",
        workspaceMode: "git",
      }),
    );
  }

  for (const repoKind of ["library", "frontend", "migration"]) {
    for (const agent of agents) {
      for (const workspaceMode of workspaceModes) {
        scenarios.push(
          createScenario({
            kind: "single",
            repoKind,
            agent,
            workspaceMode,
            candidateCount: 1,
          }),
        );
        scenarios.push(
          createScenario({
            kind: "advanced-override",
            repoKind,
            agent,
            workspaceMode,
          }),
        );
      }
    }
  }

  for (const repoKind of ["library", "frontend", "migration"]) {
    for (const agent of agents) {
      for (const workspaceMode of workspaceModes) {
        for (const packageManager of packageManagers) {
          scenarios.push(
            createScenario({
              kind: "happy",
              repoKind,
              agent,
              workspaceMode,
              packageManager,
            }),
          );
        }
      }
    }
  }

  for (const agent of agents) {
    for (const workspaceMode of workspaceModes) {
      scenarios.push(
        createScenario({
          kind: "runtime-missing",
          repoKind: "library",
          agent,
          workspaceMode,
          binaryMode: "missing",
        }),
      );
    }
  }

  scenarios.push(
    createScenario({
      kind: "filelike-inline-consult",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      taskInputMode: "filelike-inline",
    }),
  );
  scenarios.push(
    createScenario({
      kind: "filelike-inline-draft",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      taskInputMode: "filelike-inline",
    }),
  );

  for (const agent of agents) {
    for (const workspaceMode of workspaceModes) {
      scenarios.push(
        createScenario({
          kind: "monorepo",
          repoKind: "monorepo",
          agent,
          workspaceMode,
          packageManager: "pnpm",
          profileId: "library",
        }),
      );
      scenarios.push(
        createScenario({
          kind: "hung-runtime",
          repoKind: "library",
          agent,
          workspaceMode,
          timeoutMs: 300,
        }),
      );
      scenarios.push(
        createScenario({
          kind: "large-diff",
          repoKind: "library",
          agent,
          workspaceMode,
        }),
      );
    }
  }

  for (const workspaceMode of workspaceModes) {
    scenarios.push(
      createScenario({
        kind: "manual-crown",
        repoKind: "library",
        agent: "codex",
        workspaceMode,
        manualCandidateId: "cand-01",
      }),
    );
    scenarios.push(
      createScenario({
        kind: "manual-crown",
        repoKind: "library",
        agent: "codex",
        workspaceMode,
        manualCandidateId: "cand-02",
      }),
    );
  }

  return scenarios;
}

function buildCorpusScenarios() {
  return [
    createScenario({
      kind: "monorepo",
      repoKind: "monorepo",
      agent: "codex",
      workspaceMode: "git",
      packageManager: "pnpm",
      profileId: "library",
      corpusName: "monorepo-git-codex",
    }),
    createScenario({
      kind: "monorepo",
      repoKind: "monorepo",
      agent: "claude-code",
      workspaceMode: "copy",
      packageManager: "pnpm",
      profileId: "library",
      corpusName: "monorepo-copy-claude",
    }),
    createScenario({
      kind: "hung-runtime",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      timeoutMs: 300,
      corpusName: "hung-runtime-git-codex",
    }),
    createScenario({
      kind: "hung-runtime",
      repoKind: "library",
      agent: "claude-code",
      workspaceMode: "copy",
      timeoutMs: 300,
      corpusName: "hung-runtime-copy-claude",
    }),
    createScenario({
      kind: "large-diff",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      corpusName: "large-diff-git-codex",
    }),
    createScenario({
      kind: "large-diff",
      repoKind: "library",
      agent: "claude-code",
      workspaceMode: "copy",
      corpusName: "large-diff-copy-claude",
    }),
    createScenario({
      kind: "manual-crown",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      manualCandidateId: "cand-01",
      corpusName: "manual-crown-cand-01",
    }),
    createScenario({
      kind: "manual-crown",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      manualCandidateId: "cand-02",
      corpusName: "manual-crown-cand-02",
    }),
    createScenario({
      kind: "repair",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      corpusName: "repair-library",
    }),
    createScenario({
      kind: "advanced-override",
      repoKind: "frontend",
      agent: "claude-code",
      workspaceMode: "copy",
      corpusName: "advanced-override-frontend",
    }),
    createScenario({
      kind: "stale-base",
      repoKind: "migration",
      agent: "codex",
      workspaceMode: "git",
      corpusName: "migration-stale-base",
    }),
    createScenario({
      kind: "filelike-inline-consult",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      taskInputMode: "filelike-inline",
      corpusName: "filelike-inline-consult",
    }),
  ];
}

function createScenario({
  kind,
  repoKind,
  agent,
  workspaceMode,
  binaryMode = "fake",
  candidateCount,
  packageManager,
  taskInputMode,
  profileId,
  timeoutMs,
  manualCandidateId,
  corpusName,
}) {
  const resolvedCandidateCount =
    candidateCount ??
    (kind === "repair" || kind === "draft" || kind === "filelike-inline-draft" ? 1 : 2);
  const resolvedTaskInputMode =
    taskInputMode ??
    (kind === "happy" || kind === "repair" || kind === "single" || kind === "runtime-missing"
      ? "inline"
      : "file");
  return {
    id: [
      ...(corpusName ? [corpusName] : []),
      repoKind,
      agent.replaceAll("claude-code", "claude"),
      workspaceMode,
      ...(packageManager ? [packageManager] : []),
      ...(manualCandidateId ? [manualCandidateId] : []),
      ...(binaryMode === "missing" ? ["missing-bin"] : []),
      kind,
    ].join("-"),
    kind,
    repoKind,
    agent,
    workspaceMode,
    profileId:
      profileId ?? (repoKind === "plain" || repoKind === "monorepo" ? "library" : repoKind),
    binaryMode,
    candidateCount: resolvedCandidateCount,
    packageManager,
    taskInputMode: resolvedTaskInputMode,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(manualCandidateId ? { manualCandidateId } : {}),
  };
}

async function prepareScenario(workdir, scenario) {
  await mkdir(workdir, { recursive: true });
  await writeRepositoryTemplate(workdir, scenario);
  await writeTaskInputs(workdir, scenario.repoKind);

  if (scenario.workspaceMode === "git") {
    runOrThrow("git", ["init"], { cwd: workdir });
    runOrThrow("git", ["config", "user.name", "Evidence Bot"], { cwd: workdir });
    runOrThrow("git", ["config", "user.email", "evidence@example.com"], { cwd: workdir });
    runOrThrow("git", ["add", "."], { cwd: workdir });
    runOrThrow("git", ["commit", "-m", "base"], { cwd: workdir });
  }

  runCli(["init"], { cwd: workdir });

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

  const taskArgument =
    scenario.taskInputMode === "inline"
      ? buildInlineTaskText(scenario.repoKind)
      : scenario.taskInputMode === "filelike-inline"
        ? "fix/session-loss-on-refresh"
        : join("tasks", `${scenario.repoKind}.md`);

  if (scenario.kind === "draft" || scenario.kind === "filelike-inline-draft") {
    const draft = runCli(["draft", taskArgument, "--agent", scenario.agent, "--candidates", "1"], {
      cwd: workdir,
      env,
    });
    assertContains(draft.stdout, "Drafted only.");
    const run = await readNewestRunManifest(workdir);
    assertEqual(run.status, "planned", `${scenario.id}: expected a planned consultation.`);
    assertEqual(
      run.profileSelection?.source,
      "fallback-detection",
      `${scenario.id}: draft should skip runtime profile selection.`,
    );
    if (scenario.kind === "filelike-inline-draft") {
      assertEqual(
        run.taskPacket.sourceKind,
        "task-note",
        `${scenario.id}: file-like draft input should materialize as a generated task note.`,
      );
      assertContains(
        run.taskPacket.sourcePath,
        ".oraculum/tasks/",
        `${scenario.id}: file-like draft input should land under generated tasks.`,
      );
    }
    return;
  }

  const consult = runCli(
    [
      "consult",
      taskArgument,
      "--agent",
      scenario.agent,
      "--candidates",
      String(scenario.candidateCount),
      "--timeout-ms",
      String(scenario.timeoutMs ?? 20000),
    ],
    { cwd: workdir, env },
  );
  assertContains(consult.stdout, "Consultation complete.");

  const run = await readLatestRunManifest(workdir);
  assertEqual(run.status, "completed", `${scenario.id}: expected a completed consultation.`);
  assertEqual(
    run.profileSelection?.profileId,
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
    const verdict = runCli(["verdict"], { cwd: workdir, env });
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
    const verdict = runCli(["verdict"], { cwd: workdir, env });
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
    const verdict = runCli(["verdict"], { cwd: workdir, env });
    assertContains(verdict.stdout, "choose a candidate manually");
    const crown = runCli(["crown", "cand-02", "--branch", buildBranchName(scenario, "manual")], {
      cwd: workdir,
      env,
    });
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
    const followup = runCli(
      [
        "consult",
        buildInlineTaskText(scenario.repoKind),
        "--agent",
        scenario.agent,
        "--candidates",
        "2",
        "--timeout-ms",
        "20000",
      ],
      { cwd: workdir, env: secondEnv },
    );
    assertContains(followup.stdout, "Consultation complete.");
    const crown = runCli(
      [
        "crown",
        scenario.manualCandidateId,
        "--consultation",
        firstRunId,
        "--branch",
        buildBranchName(scenario, scenario.manualCandidateId),
      ],
      { cwd: workdir, env },
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
    const crown = runCli(["crown", "--branch", buildBranchName(scenario, "stale")], {
      cwd: workdir,
      env,
      allowFailure: true,
    });
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
    const crown = runCli(["crown", "--branch", branchName], {
      cwd: workdir,
      env,
      allowFailure: true,
    });
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
    const verdict = runCli(["verdict"], { cwd: workdir, env });
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
    assertEqual(
      run.taskPacket.sourceKind,
      "task-note",
      `${scenario.id}: file-like text should be materialized as a generated task note.`,
    );
    assertContains(
      run.taskPacket.sourcePath,
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
  const crown = runCli(
    ["crown", ...(candidateId === "cand-02" ? [] : [candidateId]), "--branch", branchName],
    { cwd: workdir, env },
  );
  assertContains(crown.stdout, `Crowned ${candidateId}`);
  await assertTargetFileContains(workdir, scenario, candidateId);

  if (scenario.workspaceMode === "git") {
    const branch = runOrThrow("git", ["branch", "--show-current"], { cwd: workdir }).stdout.trim();
    assertEqual(branch, branchName, `${scenario.id}: expected crowned git branch.`);
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
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
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
      packageManager: "pnpm@0.0.0",
      workspaces: ["packages/*"],
      scripts: {
        lint: "turbo run lint --filter @acme/app",
        typecheck: "turbo run typecheck --filter @acme/app",
        test: "turbo run test --filter @acme/app",
        build: "turbo run build --filter @acme/app",
      },
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

async function writeTaskInputs(root, repoKind) {
  await mkdir(join(root, "tasks"), { recursive: true });
  const taskBodies = {
    library: "# Library patch\nUpdate the greeting implementation.\n",
    frontend: "# Frontend patch\nUpdate the page title.\n",
    migration: "# Migration patch\nAdjust the schema comment.\n",
    plain: "# Plain patch\nUpdate the greeting text.\n",
    monorepo: "# Monorepo patch\nUpdate the workspace package greeting.\n",
  };
  await writeFile(join(root, "tasks", `${repoKind}.md`), taskBodies[repoKind], "utf8");
}

function buildInlineTaskText(repoKind) {
  if (repoKind === "monorepo") {
    return "Update packages/app/src/index.js so greet() returns a winner-specific hello string.";
  }
  if (repoKind === "frontend") {
    return "Update src/page.js so TITLE reflects the winning candidate with a minimal patch.";
  }
  if (repoKind === "migration") {
    return "Update prisma/schema.prisma with a small marker comment for the winning candidate.";
  }
  return "Update src/index.js so greet() returns a winner-specific hello string.";
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
const isProfile = prompt.includes("You are selecting the best Oraculum consultation profile");
const isWinner = prompt.includes("You are selecting the best Oraculum finalist.");
const isRepair = prompt.includes("Repair context:");
const scenario = ${JSON.stringify({
    kind: scenario.kind,
    repoKind: scenario.repoKind,
    profileId: scenario.profileId,
    candidateCount: scenario.candidateCount,
    agent: scenario.agent,
  })};

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

if (!isProfile && !isWinner) {
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
  process.stdout.write(JSON.stringify({ event: "started", mode: isProfile ? "profile" : isWinner ? "winner" : "candidate" }) + "\\n");
  if (out) {
    const payload = isProfile ? profilePayload() : isWinner ? winnerPayload() : candidateSummary();
    fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  }
  process.stderr.write("");
  process.exit(0);
}

const payload = isProfile
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

function runCli(args, options) {
  return runOrThrow(process.execPath, [distCliPath, ...args], options);
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

async function assertTargetFileContains(root, scenario, candidateId) {
  const file =
    scenario.repoKind === "monorepo"
      ? join(root, "packages", "app", "src", "index.js")
      : scenario.repoKind === "frontend"
        ? join(root, "src", "page.js")
        : scenario.repoKind === "migration"
          ? join(root, "prisma", "schema.prisma")
          : join(root, "src", "index.js");
  const contents = await readFile(file, "utf8");
  assertContains(contents, candidateId);
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

function nodeEval(source) {
  return `node -e "${source.replaceAll('"', '\\"')}"`;
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
