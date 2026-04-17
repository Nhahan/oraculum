const repoKinds = ["library", "frontend", "migration", "plain"];
const agents = ["codex", "claude-code"];
const workspaceModes = ["git", "copy"];
const packageManagers = ["pnpm", "yarn", "bun"];
export const scenarioSpecificAdvancedConfigKinds = new Set([
  "no-finalist",
  "repair",
  "advanced-override",
  "nested-workspace",
]);
export const javaStatusFileSegments = ["src", "main", "java", "example", "Status.java"];
export const nestedWorkspaceStatusFileSegments = ["workspaces", "review-app", "src", "status.txt"];
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
export const taskInputEdgeCases = {
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

export function resolveEvidenceMode() {
  const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
  if (modeArgument) {
    return modeArgument.slice("--mode=".length);
  }
  return process.env.ORACULUM_EVIDENCE_MODE ?? "matrix";
}

export function buildScenarioSet(mode) {
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

export function buildPolyglotScenarios() {
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

export function buildCorpusScenarios() {
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

export function buildExplicitMarkerOracle(repoKind) {
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

export function markerFileSegmentsForScenario(repoKind) {
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

export function buildInlineTaskText(repoKind) {
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
