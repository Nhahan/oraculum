import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distCliPath = join(repoRoot, "dist", "cli.js");
const distMcpToolsPath = join(repoRoot, "dist", "services", "mcp-tools.js");
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";
const evidenceMode = resolveEvidenceMode();

const repoKinds = ["library", "frontend", "migration", "plain"];
const agents = ["codex", "claude-code"];
const workspaceModes = ["git", "copy"];
const packageManagers = ["pnpm", "yarn", "bun"];
const scenarioSpecificAdvancedConfigKinds = new Set([
  "no-finalist",
  "repair",
  "advanced-override",
  "nested-workspace",
]);
const javaStatusFileSegments = ["src", "main", "java", "example", "Status.java"];
const nestedWorkspaceStatusFileSegments = ["workspaces", "review-app", "src", "status.txt"];
const explicitMarkerOracleFixtures = {
  python: {
    label: "Python",
    fileSegments: ["src", "app.py"],
  },
  go: {
    label: "Go",
    fileSegments: ["internal", "status", "status.go"],
  },
  rust: {
    label: "Rust",
    fileSegments: ["src", "lib.rs"],
  },
  "java-gradle": {
    label: "Java/Gradle",
    fileSegments: javaStatusFileSegments,
  },
  "java-maven": {
    label: "Java/Maven",
    fileSegments: javaStatusFileSegments,
  },
  polyglot: {
    label: "Polyglot",
    fileSegments: ["services", "worker", "app.py"],
  },
};
const taskInputEdgeCases = {
  "unicode-file": {
    pathSegments: ["tasks", "사업화_준비도_검토보고서.md"],
    taskBody: "# 보고서 검토\nHTML 품질을 검토하고 winner marker를 반영한다.\n",
  },
  "space-file": {
    pathSegments: ["tasks", "review notes", "quality review.md"],
    taskBody: "# Quality review\nUpdate the implementation while preserving spaced task paths.\n",
  },
  "source-html": {
    pathSegments: ["site", "index.html"],
  },
  "source-py": {
    pathSegments: ["src", "app.py"],
  },
  "source-go": {
    pathSegments: ["internal", "status", "status.go"],
  },
  "source-rs": {
    pathSegments: ["src", "lib.rs"],
  },
};

function resolveEvidenceMode() {
  const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
  if (modeArgument) {
    return modeArgument.slice("--mode=".length);
  }
  return process.env.ORACULUM_EVIDENCE_MODE ?? "matrix";
}

async function main() {
  if (!existsSync(distCliPath) || !existsSync(distMcpToolsPath)) {
    throw new Error(
      `Built Oraculum artifacts were not found under dist. Run "npm run build" first.`,
    );
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

function buildScenarioSet(mode) {
  if (mode === "polyglot") {
    return buildPolyglotScenarios();
  }
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

function buildPolyglotScenarios() {
  return [
    createScenario({
      kind: "happy",
      repoKind: "plain",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "generic-no-package-json",
    }),
    createScenario({
      kind: "happy",
      repoKind: "python",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "python-explicit-oracle",
    }),
    createScenario({
      kind: "happy",
      repoKind: "go",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "go-explicit-oracle",
    }),
    createScenario({
      kind: "happy",
      repoKind: "rust",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "rust-explicit-oracle",
    }),
    createScenario({
      kind: "happy",
      repoKind: "java-gradle",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "java-gradle-explicit-oracle",
    }),
    createScenario({
      kind: "happy",
      repoKind: "java-maven",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "java-maven-explicit-oracle",
    }),
    createScenario({
      kind: "happy",
      repoKind: "docs-static",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "docs-static-no-node-scripts",
    }),
    createScenario({
      kind: "happy",
      repoKind: "polyglot",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "mixed-polyglot-explicit-oracle",
    }),
    createScenario({
      kind: "nested-workspace",
      repoKind: "nested-workspace",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      taskInputMode: "inline",
      corpusName: "nested-workspace-explicit-oracle",
    }),
    createScenario({
      kind: "subdirectory-invocation",
      repoKind: "plain",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "package-free-subdirectory-invocation",
    }),
    createScenario({
      kind: "timed-out-oracle",
      repoKind: "plain",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      candidateCount: 1,
      corpusName: "timed-out-oracle-child-cleanup",
    }),
    createScenario({
      kind: "migration-missing-capability",
      repoKind: "alembic",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      corpusName: "alembic-missing-capability",
    }),
    createScenario({
      kind: "migration-explicit-oracle",
      repoKind: "alembic",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "migration",
      corpusName: "alembic-explicit-oracle",
    }),
  ];
}

function buildCorpusScenarios() {
  return [
    ...buildPolyglotScenarios(),
    createScenario({
      kind: "task-input-edge",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "library",
      taskInputMode: "unicode-file",
      corpusName: "task-input-unicode-file",
    }),
    createScenario({
      kind: "task-input-edge",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "library",
      taskInputMode: "space-file",
      corpusName: "task-input-space-path",
    }),
    createScenario({
      kind: "task-input-edge",
      repoKind: "docs-static",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      taskInputMode: "source-html",
      corpusName: "task-input-source-html",
    }),
    createScenario({
      kind: "task-input-edge",
      repoKind: "python",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      taskInputMode: "source-py",
      corpusName: "task-input-source-py",
    }),
    createScenario({
      kind: "task-input-edge",
      repoKind: "go",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      taskInputMode: "source-go",
      corpusName: "task-input-source-go",
    }),
    createScenario({
      kind: "task-input-edge",
      repoKind: "rust",
      agent: "codex",
      workspaceMode: "copy",
      profileId: "generic",
      taskInputMode: "source-rs",
      corpusName: "task-input-source-rs",
    }),
    createScenario({
      kind: "happy",
      repoKind: "docs",
      agent: "codex",
      workspaceMode: "git",
      profileId: "library",
      corpusName: "docs-git-codex",
    }),
    createScenario({
      kind: "happy",
      repoKind: "docs",
      agent: "claude-code",
      workspaceMode: "copy",
      profileId: "library",
      corpusName: "docs-copy-claude",
    }),
    createScenario({
      kind: "no-finalist",
      repoKind: "docs",
      agent: "codex",
      workspaceMode: "git",
      profileId: "library",
      corpusName: "docs-no-finalist-codex",
    }),
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
      workspaceMode: "git",
      packageManager: "pnpm",
      profileId: "library",
      corpusName: "monorepo-git-claude",
    }),
    createScenario({
      kind: "monorepo",
      repoKind: "monorepo",
      agent: "codex",
      workspaceMode: "copy",
      packageManager: "pnpm",
      profileId: "library",
      corpusName: "monorepo-copy-codex",
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
      kind: "monorepo",
      repoKind: "monorepo",
      agent: "codex",
      workspaceMode: "git",
      packageManager: "bun",
      profileId: "library",
      corpusName: "monorepo-bun-git-codex",
    }),
    createScenario({
      kind: "monorepo",
      repoKind: "monorepo",
      agent: "claude-code",
      workspaceMode: "copy",
      packageManager: "yarn",
      profileId: "library",
      corpusName: "monorepo-yarn-copy-claude",
    }),
    createScenario({
      kind: "happy",
      repoKind: "service",
      agent: "codex",
      workspaceMode: "git",
      profileId: "library",
      corpusName: "service-git-codex",
    }),
    createScenario({
      kind: "happy",
      repoKind: "service",
      agent: "claude-code",
      workspaceMode: "copy",
      profileId: "library",
      corpusName: "service-copy-claude",
    }),
    createScenario({
      kind: "no-finalist",
      repoKind: "service",
      agent: "codex",
      workspaceMode: "git",
      profileId: "library",
      corpusName: "service-no-finalist-codex",
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
      workspaceMode: "git",
      timeoutMs: 300,
      corpusName: "hung-runtime-git-claude",
    }),
    createScenario({
      kind: "hung-runtime",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      timeoutMs: 300,
      corpusName: "hung-runtime-copy-codex",
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
      workspaceMode: "git",
      corpusName: "large-diff-git-claude",
    }),
    createScenario({
      kind: "large-diff",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      corpusName: "large-diff-copy-codex",
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
      workspaceMode: "git",
      manualCandidateId: "cand-02",
      corpusName: "manual-crown-cand-02-git",
    }),
    createScenario({
      kind: "manual-crown",
      repoKind: "library",
      agent: "claude-code",
      workspaceMode: "copy",
      manualCandidateId: "cand-01",
      corpusName: "manual-crown-claude-cand-01-copy",
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
      kind: "repair",
      repoKind: "frontend",
      agent: "claude-code",
      workspaceMode: "copy",
      corpusName: "repair-frontend-copy-claude",
    }),
    createScenario({
      kind: "advanced-override",
      repoKind: "frontend",
      agent: "claude-code",
      workspaceMode: "copy",
      corpusName: "advanced-override-frontend",
    }),
    createScenario({
      kind: "advanced-override",
      repoKind: "migration",
      agent: "codex",
      workspaceMode: "git",
      corpusName: "advanced-override-migration",
    }),
    createScenario({
      kind: "stale-base",
      repoKind: "migration",
      agent: "codex",
      workspaceMode: "git",
      corpusName: "migration-stale-base",
    }),
    createScenario({
      kind: "stale-base",
      repoKind: "library",
      agent: "claude-code",
      workspaceMode: "git",
      corpusName: "library-stale-base-claude",
    }),
    createScenario({
      kind: "branch-exists",
      repoKind: "frontend",
      agent: "claude-code",
      workspaceMode: "git",
      corpusName: "frontend-branch-exists-claude",
    }),
    createScenario({
      kind: "no-finalist",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "copy",
      corpusName: "library-no-finalist-copy-codex",
    }),
    createScenario({
      kind: "runtime-missing",
      repoKind: "library",
      agent: "claude-code",
      workspaceMode: "git",
      binaryMode: "missing",
      corpusName: "library-runtime-missing-claude",
    }),
    createScenario({
      kind: "single",
      repoKind: "frontend",
      agent: "codex",
      workspaceMode: "git",
      candidateCount: 1,
      corpusName: "frontend-single-candidate",
    }),
    createScenario({
      kind: "filelike-inline-consult",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      taskInputMode: "filelike-inline",
      corpusName: "filelike-inline-consult",
    }),
    createScenario({
      kind: "filelike-inline-draft",
      repoKind: "library",
      agent: "codex",
      workspaceMode: "git",
      taskInputMode: "filelike-inline",
      corpusName: "filelike-inline-draft",
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
      profileId ??
      (kind === "runtime-missing" || kind === "hung-runtime"
        ? "generic"
        : repoKind === "plain" ||
            repoKind === "monorepo" ||
            repoKind === "docs" ||
            repoKind === "service"
          ? "library"
          : repoKind),
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
  await writeTaskInputs(workdir, scenario);
  if (scenario.kind === "subdirectory-invocation") {
    await mkdir(invocationCwdForScenario(workdir, scenario), { recursive: true });
  }

  if (scenario.workspaceMode === "git") {
    runOrThrow("git", ["init"], { cwd: workdir });
    runOrThrow("git", ["config", "user.name", "Evidence Bot"], { cwd: workdir });
    runOrThrow("git", ["config", "user.email", "evidence@example.com"], { cwd: workdir });
    runOrThrow("git", ["add", "."], { cwd: workdir });
    runOrThrow("git", ["commit", "-m", "base"], { cwd: workdir });
  }

  await runInitToolRequest({ cwd: workdir });

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

  if (scenario.kind === "nested-workspace") {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "nested-workspace-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("workspaces", "review-app", "tools", "check-status.mjs")],
          invariant: "The nested workspace check must validate the nested target file.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "subdirectory-invocation") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "check-subdirectory-root.mjs"),
      [
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const projectRoot = process.env.ORACULUM_PROJECT_ROOT;",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!projectRoot || !workspace) {",
        '  process.stderr.write("missing Oraculum root/workspace environment");',
        "  process.exit(1);",
        "}",
        'if (!existsSync(join(projectRoot, ".oraculum", "config.json"))) {',
        '  process.stderr.write("project root .oraculum config missing");',
        "  process.exit(1);",
        "}",
        'if (existsSync(join(projectRoot, "packages", "app", ".oraculum"))) {',
        '  process.stderr.write("nested invocation created a stray .oraculum directory");',
        "  process.exit(1);",
        "}",
        'const text = readFileSync(join(workspace, "src", "index.js"), "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("subdirectory root oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "subdirectory-root-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "check-subdirectory-root.mjs")],
          invariant: "A nested invocation must keep project artifacts at the initialized root.",
          enforcement: "hard",
        },
      ],
    });
  }

  if (scenario.kind === "timed-out-oracle") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "spawn-timeout-child.mjs"),
      [
        'import { spawn } from "node:child_process";',
        'import { join } from "node:path";',
        "",
        "const projectRoot = process.env.ORACULUM_PROJECT_ROOT;",
        "if (!projectRoot) {",
        '  process.stderr.write("missing ORACULUM_PROJECT_ROOT");',
        "  process.exit(1);",
        "}",
        'const markerPath = join(projectRoot, "oracle-timeout-child-survived.txt");',
        "spawn(",
        "  process.execPath,",
        "  [",
        '    "-e",',
        "    [",
        '      "setTimeout(() => require(\\"node:fs\\").writeFileSync(process.env.ORACULUM_TIMEOUT_MARKER_PATH, \\"alive\\\\n\\"), 700);",',
        '      "setInterval(() => {}, 1000);",',
        '    ].join("\\n"),',
        "  ],",
        '  { env: { ...process.env, ORACULUM_TIMEOUT_MARKER_PATH: markerPath }, stdio: "ignore" },',
        ");",
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "timeout-child-cleanup",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "spawn-timeout-child.mjs")],
          invariant: "Timed-out oracle subprocess trees must be cleaned up.",
          enforcement: "signal",
          timeoutMs: 100,
        },
      ],
    });
  }

  if (scenario.kind === "migration-explicit-oracle") {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(
      join(workdir, "tools", "check-alembic.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!workspace) {",
        '  process.stderr.write("missing ORACULUM_CANDIDATE_WORKSPACE_DIR");',
        "  process.exit(1);",
        "}",
        'const file = join(workspace, "migrations", "versions", "0001_initial.py");',
        'const text = readFileSync(file, "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("explicit alembic oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [
        {
          id: "migration-explicit-impact",
          roundId: "impact",
          command: process.execPath,
          args: [join("tools", "check-alembic.mjs")],
          invariant: "The Alembic-shaped fixture must use an explicit repo-local migration check.",
          enforcement: "hard",
        },
      ],
    });
  }

  const explicitMarkerOracle = buildExplicitMarkerOracle(scenario.repoKind);
  if (explicitMarkerOracle && !scenarioSpecificAdvancedConfigKinds.has(scenario.kind)) {
    await writeAdvancedConfig(workdir, {
      version: 1,
      oracles: [explicitMarkerOracle],
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

function buildExplicitMarkerOracle(repoKind) {
  const fixture = explicitMarkerOracleFixtures[repoKind];
  if (!fixture) {
    return undefined;
  }

  const fileSegments = fixture.fileSegments.map((segment) => JSON.stringify(segment)).join(", ");

  return {
    id: `${repoKind}-explicit-impact`,
    roundId: "impact",
    command: process.execPath,
    args: [
      "-e",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `const file = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, ${fileSegments});`,
        "const text = fs.readFileSync(file, 'utf8');",
        "if (!text.includes('cand-')) { process.stderr.write('candidate marker missing'); process.exit(1); }",
        `process.stdout.write(${JSON.stringify(`explicit ${repoKind} oracle ok`)});`,
      ].join(" "),
    ],
    invariant: `The ${fixture.label}-shaped fixture must pass only the explicit repo-local Oraculum oracle.`,
    enforcement: "hard",
  };
}

function markerFileSegmentsForScenario(repoKind) {
  const explicitMarkerFixture = explicitMarkerOracleFixtures[repoKind];
  if (explicitMarkerFixture) {
    return explicitMarkerFixture.fileSegments;
  }
  if (repoKind === "docs-static") {
    return ["site", "index.html"];
  }
  if (repoKind === "nested-workspace") {
    return nestedWorkspaceStatusFileSegments;
  }
  if (repoKind === "alembic") {
    return ["migrations", "versions", "0001_initial.py"];
  }
  return undefined;
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
      timeoutMs: scenario.timeoutMs ?? 20000,
    },
    { env },
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
        timeoutMs: 20000,
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
      run.profileSelection?.missingCapabilities.join("\n") ?? "",
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
    assertContains(verdict.stdout, "Profile gaps:");
    assertContains(verdict.stdout, "No repo-local validation command was detected.");
    assertContains(verdict.stdout, "Skipped profile commands:");
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
      run.profileSelection?.missingCapabilities.length,
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
    if ((packageManager ?? "pnpm") === "pnpm") {
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    }
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
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      workspaces: ["packages/*"],
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
    for (const [dir, name] of [
      ["bin", "lint"],
      ["scripts", "typecheck"],
      ["scripts", "test"],
      ["bin", "build"],
    ]) {
      await writeRepoEntrypoint(
        root,
        dir,
        name,
        `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "packages", "app", "src", "index.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing monorepo app entry");
  process.exit(1);
}
process.stdout.write(${JSON.stringify(`${name} workspace ok`)});
`,
      );
    }
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

  if (repoKind === "docs") {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "report.md"),
      "# Baseline report\n\nThe current report needs editorial cleanup.\n",
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-docs",
      version: "0.0.0",
      type: "module",
      scripts: {
        lint: `${nodeEval("process.exit(0)")}`,
        typecheck: `${nodeEval("process.exit(0)")}`,
        test: `${nodeEval("process.exit(0)")}`,
        build: `${nodeEval("process.exit(0)")}`,
      },
    });
    return;
  }

  if (repoKind === "docs-static") {
    await mkdir(join(root, "site"), { recursive: true });
    await writeFile(
      join(root, "site", "index.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        "    <title>Scenario Docs</title>",
        "  </head>",
        "  <body>",
        '    <p data-status="offline">offline</p>',
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
      "utf8",
    );
    return;
  }

  if (repoKind === "python") {
    await writeFile(join(root, "src", "app.py"), 'def status():\n    return "offline"\n', "utf8");
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "scenario-python"\n');
    return;
  }

  if (repoKind === "go") {
    await mkdir(join(root, "internal", "status"), { recursive: true });
    await writeFile(join(root, "go.mod"), "module example.com/scenario\n\ngo 1.22\n", "utf8");
    await writeFile(
      join(root, "internal", "status", "status.go"),
      'package status\n\nfunc Status() string {\n\treturn "offline"\n}\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "rust") {
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname = "scenario-rust"\nversion = "0.1.0"\nedition = "2021"\n',
      "utf8",
    );
    await writeFile(
      join(root, "src", "lib.rs"),
      "pub fn status() -> &" + 'static str {\n    "offline"\n}\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "java-gradle") {
    await writeFile(
      join(root, "settings.gradle"),
      "rootProject.name = 'scenario-gradle'\n",
      "utf8",
    );
    await writeFile(join(root, "build.gradle"), "plugins {\n  id 'java'\n}\n", "utf8");
    await writeJavaStatusSource(root);
    return;
  }

  if (repoKind === "java-maven") {
    await writeFile(
      join(root, "pom.xml"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<project>",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>example</groupId>",
        "  <artifactId>scenario-maven</artifactId>",
        "  <version>0.1.0</version>",
        "</project>",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeJavaStatusSource(root);
    return;
  }

  if (repoKind === "polyglot") {
    await mkdir(join(root, "services", "worker"), { recursive: true });
    await writePackageJson(root, {
      name: "scenario-polyglot",
      version: "0.0.0",
      type: "module",
    });
    await writeFile(join(root, "src", "index.js"), 'export const status = "offline";\n', "utf8");
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "scenario-polyglot"\n');
    await writeFile(join(root, "go.mod"), "module example.com/polyglot\n\ngo 1.22\n", "utf8");
    await writeFile(join(root, "services", "worker", "app.py"), 'STATUS = "offline"\n', "utf8");
    return;
  }

  if (repoKind === "nested-workspace") {
    await mkdir(join(root, "workspaces", "review-app", "tools"), { recursive: true });
    await mkdir(join(root, "workspaces", "review-app", "src"), { recursive: true });
    await writeFile(join(root, ...nestedWorkspaceStatusFileSegments), 'status="offline"\n', "utf8");
    await writeFile(
      join(root, "workspaces", "review-app", "tools", "check-status.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "",
        "const workspace = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR;",
        "if (!workspace) {",
        '  process.stderr.write("missing ORACULUM_CANDIDATE_WORKSPACE_DIR");',
        "  process.exit(1);",
        "}",
        'const file = join(workspace, "workspaces", "review-app", "src", "status.txt");',
        'const text = readFileSync(file, "utf8");',
        'if (!text.includes("cand-")) {',
        '  process.stderr.write("candidate marker missing");',
        "  process.exit(1);",
        "}",
        'process.stdout.write("nested workspace oracle ok");',
        "",
      ].join("\n"),
      "utf8",
    );
    return;
  }

  if (repoKind === "alembic") {
    await mkdir(join(root, "migrations", "versions"), { recursive: true });
    await writeFile(join(root, "alembic.ini"), "[alembic]\nscript_location = migrations\n", "utf8");
    await writeFile(
      join(root, "migrations", "env.py"),
      'def run_migrations_online():\n    return "offline"\n',
      "utf8",
    );
    await writeFile(
      join(root, "migrations", "versions", "0001_initial.py"),
      'revision_message = "offline"\n',
      "utf8",
    );
    return;
  }

  if (repoKind === "service") {
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "src", "server.js"),
      'export function serviceStatus() {\n  return "offline";\n}\n',
      "utf8",
    );
    await writeFile(
      join(root, "routes", "health.js"),
      'export const healthRoute = "/health";\n',
      "utf8",
    );
    await writeFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.0.0",
        "info:",
        "  title: Service API",
        "  version: 0.0.0",
        "paths:",
        "  /health:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: ok",
        "",
      ].join("\n"),
      "utf8",
    );
    await writePackageJson(root, {
      name: "scenario-service",
      version: "0.0.0",
      type: "module",
      ...(packageManager ? { packageManager: `${packageManager}@0.0.0` } : {}),
      main: "./src/server.js",
      exports: {
        ".": "./src/server.js",
      },
      dependencies: {
        fastify: "0.0.0",
      },
    });
    for (const [dir, name] of [
      ["bin", "lint"],
      ["scripts", "typecheck"],
      ["scripts", "test"],
      ["bin", "build"],
    ]) {
      await writeRepoEntrypoint(
        root,
        dir,
        name,
        `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.cwd(), "src", "server.js");
if (!fs.existsSync(file)) {
  process.stderr.write("missing service entry");
  process.exit(1);
}
process.stdout.write(${JSON.stringify(`${name} service ok`)});
`,
      );
    }
    return;
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

async function writeJavaStatusSource(root) {
  await mkdir(join(root, "src", "main", "java", "example"), { recursive: true });
  await writeFile(
    join(root, ...javaStatusFileSegments),
    [
      "package example;",
      "",
      "public final class Status {",
      "  private Status() {}",
      "",
      "  public static String status() {",
      '    return "offline";',
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeTaskInputs(root, scenario) {
  const { repoKind, taskInputMode } = scenario;
  await mkdir(join(root, "tasks"), { recursive: true });
  const taskBodies = {
    library: "# Library patch\nUpdate the greeting implementation.\n",
    frontend: "# Frontend patch\nUpdate the page title.\n",
    migration: "# Migration patch\nAdjust the schema comment.\n",
    plain: "# Plain patch\nUpdate the greeting text.\n",
    python: "# Python patch\nUpdate the service status text.\n",
    go: "# Go patch\nUpdate the service status text.\n",
    rust: "# Rust patch\nUpdate the service status text.\n",
    "java-gradle": "# Java/Gradle patch\nUpdate the service status text.\n",
    "java-maven": "# Java/Maven patch\nUpdate the service status text.\n",
    "docs-static": "# Static docs patch\nUpdate the page status text.\n",
    polyglot: "# Polyglot patch\nUpdate the worker status text.\n",
    "nested-workspace": "# Nested workspace patch\nUpdate the nested status text.\n",
    alembic: "# Alembic migration patch\nUpdate the migration revision marker.\n",
    docs: "# Docs patch\nRevise the report wording.\n",
    service: "# Service patch\nUpdate the service status response.\n",
    monorepo: "# Monorepo patch\nUpdate the workspace package greeting.\n",
  };
  await writeFile(join(root, "tasks", `${repoKind}.md`), taskBodies[repoKind], "utf8");
  const edgeCase = taskInputEdgeCases[taskInputMode];
  if (edgeCase?.taskBody) {
    const edgeTaskPath = join(root, ...edgeCase.pathSegments);
    await mkdir(dirname(edgeTaskPath), { recursive: true });
    await writeFile(edgeTaskPath, edgeCase.taskBody, "utf8");
  }
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
  if (repoKind === "docs") {
    return "Update docs/report.md so the report reflects the winning candidate with a small editorial change.";
  }
  if (repoKind === "docs-static") {
    return "Update site/index.html so the status reflects the winning candidate without adding package scripts.";
  }
  if (repoKind === "python") {
    return "Update src/app.py so status() returns a winner-specific online status string.";
  }
  if (repoKind === "go") {
    return "Update internal/status/status.go so Status() returns a winner-specific online status string.";
  }
  if (repoKind === "rust") {
    return "Update src/lib.rs so status() returns a winner-specific online status string.";
  }
  if (repoKind === "java-gradle") {
    return "Update src/main/java/example/Status.java so status() returns a winner-specific online status string.";
  }
  if (repoKind === "java-maven") {
    return "Update src/main/java/example/Status.java so status() returns a winner-specific online status string.";
  }
  if (repoKind === "polyglot") {
    return "Update services/worker/app.py so STATUS returns a winner-specific online status string.";
  }
  if (repoKind === "nested-workspace") {
    return "Update workspaces/review-app/src/status.txt so the nested workspace status includes the winning candidate.";
  }
  if (repoKind === "alembic") {
    return "Update migrations/versions/0001_initial.py so the migration marker includes the winning candidate.";
  }
  if (repoKind === "service") {
    return "Update src/server.js so serviceStatus() returns a winner-specific online status string.";
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

async function writeRepoEntrypoint(root, relativeDir, name, source) {
  const dir = join(root, relativeDir);
  await mkdir(dir, { recursive: true });
  await writeNodeBinary(dir, name, source);
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
const explicitMarkerFileSegments = ${JSON.stringify(
    markerFileSegmentsForScenario(scenario.repoKind),
  )};

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
  if (scenario.repoKind === "docs") {
    const file = path.join(process.cwd(), "docs", "report.md");
    const next = fs.readFileSync(file, "utf8").replace("Baseline report", "Report for " + candidateId);
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (explicitMarkerFileSegments) {
    const file = path.join(process.cwd(), ...explicitMarkerFileSegments);
    const next = fs.readFileSync(file, "utf8").replace('"offline"', '"online-' + candidateId + '"');
    fs.writeFileSync(file, next, "utf8");
    return;
  }
  if (scenario.repoKind === "service") {
    const file = path.join(process.cwd(), "src", "server.js");
    const next = fs.readFileSync(file, "utf8").replace('"offline"', '"online-' + candidateId + '"');
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
      `run=${run.id} status=${run.status} profile=${run.profileSelection?.profileId ?? "none"} recommendation=${run.recommendedWinner?.candidateId ?? "none"}`,
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

function nodeEval(source) {
  return `node -e "${source.replaceAll('"', '\\"')}"`;
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
