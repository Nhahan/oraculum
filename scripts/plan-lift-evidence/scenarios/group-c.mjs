import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeNodeBinary } from "../helpers.mjs";

export const scenarioGroupC = [
  {
    id: "dual-oracle-migration-rollback-reviewability",
    description:
      "Workspace-scoped runtime and project-scoped migration rollback oracles both pass, but only the strong candidate leaves a concrete, operator-reviewable migration bundle.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [
      { id: "payments-runtime-workspace", roundId: "impact" },
      { id: "migration-rollback-impact", roundId: "impact" },
    ],
    initialFiles() {
      return {
        "packages/payments/src/migration.ts":
          'export function currentRestoreMode() {\n  return "pending";\n}\n',
        "db/migrations/20260416_add_session_restore.sql":
          "-- pending migration\nALTER TABLE sessions ADD COLUMN restore_mode TEXT;\n",
        "docs/ROLLBACK.md": "# Rollback\n\n- pending rollback steps\n- pending operator notes\n",
        "packages/payments/check-migration-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("src/migration.ts", "utf8");',
          'if (!source.includes("session_restore_enabled")) {',
          '  console.error("payments runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("payments runtime bundle looks valid");',
        ].join("\n"),
        "tools/check-migration-rollback.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          "const migration = readFileSync(",
          '  join(workspaceRoot, "db", "migrations", "20260416_add_session_restore.sql"),',
          '  "utf8",',
          ");",
          'const rollback = readFileSync(join(workspaceRoot, "docs", "ROLLBACK.md"), "utf8");',
          'if (migration.includes("pending") || rollback.includes("pending")) {',
          '  console.error("migration or rollback bundle is still pending");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("migration and rollback bundle cleared pending state");',
        ].join("\n"),
      };
    },
    taskPacket(root) {
      return {
        id: "dual_oracle_migration_rollback_reviewability",
        title: "Revise the migration runtime and rollback bundle for session restore",
        intent:
          "Revise packages/payments/src/migration.ts, db/migrations/20260416_add_session_restore.sql, and docs/ROLLBACK.md into a coherent migration bundle. Very complex success prefers concrete, operator-reviewable runtime, migration, and rollback semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "packages/payments/src/migration.ts",
        nonGoals: ["Do not leave the migration and rollback bundle at generic wording."],
        acceptanceCriteria: [
          "packages/payments/src/migration.ts is materially updated.",
          "db/migrations/20260416_add_session_restore.sql is materially updated.",
          "docs/ROLLBACK.md is materially updated.",
        ],
        risks: [
          "Generic migration or rollback language makes the release bundle weakly reviewable even when both oracles pass.",
        ],
        oracleHints: [
          "Keep the workspace-scoped payments runtime oracle green.",
          "Keep the project-scoped migration and rollback oracle green.",
        ],
        strategyHints: ["Prefer concrete migration defaults and rollback steps."],
        contextFiles: [
          join(root, "packages", "payments", "src", "migration.ts"),
          join(root, "db", "migrations", "20260416_add_session_restore.sql"),
          join(root, "docs", "ROLLBACK.md"),
          join(root, "packages", "payments", "check-migration-runtime.mjs"),
          join(root, "tools", "check-migration-rollback.mjs"),
        ],
      };
    },
    analyze(root) {
      const runtime = readFileSync(
        join(root, "packages", "payments", "src", "migration.ts"),
        "utf8",
      );
      const migration = readFileSync(
        join(root, "db", "migrations", "20260416_add_session_restore.sql"),
        "utf8",
      );
      const rollback = readFileSync(join(root, "docs", "ROLLBACK.md"), "utf8");
      const runtimeSpecific =
        runtime.includes("session_restore_enabled") && runtime.includes("existing-session");
      const migrationSpecific =
        migration.includes("DEFAULT 'existing-session'") &&
        migration.includes("UPDATE sessions SET restore_mode = 'existing-session'");
      const rollbackSpecific =
        rollback.includes("Disable the session-restore release flag before rollback.") &&
        rollback.includes("ALTER TABLE sessions DROP COLUMN restore_mode;");
      return {
        score: runtimeSpecific && migrationSpecific && rollbackSpecific ? 3 : 1,
        runtimeSpecific,
        migrationSpecific,
        rollbackSpecific,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "payments-runtime-workspace",
            roundId: "impact",
            command: process.execPath,
            args: ["check-migration-runtime.mjs"],
            cwd: "workspace",
            relativeCwd: "packages/payments",
            invariant:
              "The payments package runtime must enable the session restore migration path.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Payments workspace runtime oracle passed.",
            failureSummary: "Payments workspace runtime oracle failed.",
            repairHint:
              "Update packages/payments/src/migration.ts so the payments runtime check passes.",
            safetyRationale:
              "Workspace-scoped deterministic oracle for the payments package runtime.",
          },
          {
            id: "migration-rollback-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-migration-rollback.mjs"],
            cwd: "project",
            invariant: "The migration SQL and rollback runbook must both leave the pending state.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Migration rollback project oracle passed.",
            failureSummary: "Migration rollback project oracle failed.",
            repairHint:
              "Update the migration SQL and rollback runbook so both artifacts leave the pending state together.",
            safetyRationale:
              "Project-scoped deterministic oracle for the migration and rollback bundle.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        requiredChangedPaths: [
          "packages/payments/src/migration.ts",
          "db/migrations/20260416_add_session_restore.sql",
          "docs/ROLLBACK.md",
        ],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex migration work should prefer concrete runtime, migration, and rollback bundles even when both repo-local oracles already pass.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make packages/payments/src/migration.ts, db/migrations/20260416_add_session_restore.sql, and docs/ROLLBACK.md concrete and operator-reviewable while preserving both repo-local oracles.",
          "Treat generic migration defaults or rollback wording as materially weaker even when both repo-local oracles pass.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the migration or rollback bundle generic.",
          "Abstain if every finalist passes the oracles but keeps the migration bundle too vague for operator review.",
        ],
        workstreams: [
          {
            id: "payments-runtime",
            label: "Payments Runtime Contract",
            goal: "Update packages/payments/src/migration.ts with the concrete session restore runtime mode.",
            targetArtifacts: ["packages/payments/src/migration.ts"],
            requiredChangedPaths: ["packages/payments/src/migration.ts"],
            protectedPaths: [],
            oracleIds: ["payments-runtime-workspace"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "migration-sql",
            label: "Migration SQL Contract",
            goal: "Update db/migrations/20260416_add_session_restore.sql with concrete migration defaults.",
            targetArtifacts: ["db/migrations/20260416_add_session_restore.sql"],
            requiredChangedPaths: ["db/migrations/20260416_add_session_restore.sql"],
            protectedPaths: [],
            oracleIds: ["migration-rollback-impact"],
            dependencies: ["payments-runtime"],
            risks: ["Generic migration defaults weaken the release bundle."],
            disqualifiers: [],
          },
          {
            id: "rollback-runbook",
            label: "Rollback Runbook Contract",
            goal: "Update docs/ROLLBACK.md with concrete operator rollback steps that match the migration SQL.",
            targetArtifacts: ["docs/ROLLBACK.md"],
            requiredChangedPaths: ["docs/ROLLBACK.md"],
            protectedPaths: [],
            oracleIds: ["migration-rollback-impact"],
            dependencies: ["migration-sql"],
            risks: ["Generic rollback wording leaves the migration bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "migration-runtime-fit",
            label: "Migration Runtime Fit",
            dependsOn: [],
            workstreamIds: ["payments-runtime", "migration-sql", "rollback-runbook"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/payments/src/migration.ts.",
              "Materially change db/migrations/20260416_add_session_restore.sql.",
              "Materially change docs/ROLLBACK.md.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "required-path-coverage",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["generic migration rollback bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic migration rollback bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "package-script-project-oracle-reviewability",
    description:
      "A workspace package script oracle and a project-scoped migration oracle both pass, but only the strong candidate leaves a concrete, operator-reviewable release bundle.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [
      { id: "workspace-session-test", roundId: "impact" },
      { id: "release-rollback-impact", roundId: "impact" },
    ],
    initialFiles() {
      return {
        "packages/web/package.json": JSON.stringify(
          {
            name: "@fixture/web",
            private: true,
            scripts: {
              "test:session": "node ./check-session-runtime.mjs",
            },
          },
          null,
          2,
        ).concat("\n"),
        "packages/web/src/session.ts":
          "export function restoreSession(request) {\n  return null;\n}\n",
        "packages/web/check-session-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("./src/session.ts", "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("workspace package runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("workspace package runtime looks valid");',
        ].join("\n"),
        "db/migrations/20260416_release_session_restore.sql":
          "-- pending release migration\nALTER TABLE sessions ADD COLUMN restore_mode TEXT;\n",
        "docs/ROLLBACK.md":
          "# Rollback\n\n- pending release rollback\n- pending operator guidance\n",
        "tools/check-release-rollback.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          "const migration = readFileSync(",
          '  join(workspaceRoot, "db", "migrations", "20260416_release_session_restore.sql"),',
          '  "utf8",',
          ");",
          'const rollback = readFileSync(join(workspaceRoot, "docs", "ROLLBACK.md"), "utf8");',
          'if (migration.includes("pending") || rollback.includes("pending")) {',
          '  console.error("release migration or rollback bundle is still pending");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("release migration and rollback bundle cleared pending state");',
        ].join("\n"),
      };
    },
    async afterWrite(root) {
      await writeNodeBinary(
        join(root, "bin"),
        "pnpm",
        [
          'const { spawnSync } = require("node:child_process");',
          "const args = process.argv.slice(2);",
          "if (args[0] === 'run' && args[1] === 'test:session') {",
          `  const result = spawnSync(${JSON.stringify(process.execPath)}, ['check-session-runtime.mjs'], {`,
          "    cwd: process.cwd(),",
          '    stdio: "inherit",',
          "    env: process.env,",
          "  });",
          "  process.exit(result.status ?? 1);",
          "}",
          "process.stderr.write('unsupported pnpm invocation: ' + args.join(' ') + '\\n');",
          "process.exit(1);",
        ].join("\n"),
      );
    },
    taskPacket(root) {
      return {
        id: "package_script_project_oracle_reviewability",
        title: "Revise the package-tested release migration bundle for session restore",
        intent:
          "Revise packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, and docs/ROLLBACK.md into a coherent release bundle. Very complex success prefers concrete, operator-reviewable runtime, migration, and rollback semantics over generic rewrites while preserving both repo-local oracles.",
        artifactKind: "code",
        targetArtifactPath: "packages/web/src/session.ts",
        nonGoals: ["Do not leave the runtime or release bundle at generic wording."],
        acceptanceCriteria: [
          "packages/web/src/session.ts is materially updated.",
          "db/migrations/20260416_release_session_restore.sql is materially updated.",
          "docs/ROLLBACK.md is materially updated.",
        ],
        risks: [
          "Generic migration or rollback language can still be weak even when the package test and release oracle pass.",
        ],
        oracleHints: [
          "Keep the workspace package script oracle green.",
          "Keep the project-scoped release rollback oracle green.",
        ],
        strategyHints: ["Prefer concrete runtime markers and explicit rollback steps."],
        contextFiles: [
          join(root, "packages", "web", "package.json"),
          join(root, "packages", "web", "src", "session.ts"),
          join(root, "packages", "web", "check-session-runtime.mjs"),
          join(root, "db", "migrations", "20260416_release_session_restore.sql"),
          join(root, "docs", "ROLLBACK.md"),
          join(root, "tools", "check-release-rollback.mjs"),
        ],
      };
    },
    analyze(root) {
      const runtime = readFileSync(join(root, "packages", "web", "src", "session.ts"), "utf8");
      const migration = readFileSync(
        join(root, "db", "migrations", "20260416_release_session_restore.sql"),
        "utf8",
      );
      const rollback = readFileSync(join(root, "docs", "ROLLBACK.md"), "utf8");
      const runtimeSpecific =
        runtime.includes("return existingSession;") && runtime.includes("if (!existingSession)");
      const migrationSpecific =
        migration.includes("DEFAULT 'existing-session'") &&
        migration.includes("UPDATE sessions SET restore_mode = 'existing-session'");
      const rollbackSpecific =
        rollback.includes("Disable the session-restore release flag before rollback.") &&
        rollback.includes("ALTER TABLE sessions DROP COLUMN restore_mode;");
      return {
        score: runtimeSpecific && migrationSpecific && rollbackSpecific ? 3 : 1,
        runtimeSpecific,
        migrationSpecific,
        rollbackSpecific,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "workspace-session-test",
            roundId: "impact",
            command: "pnpm",
            args: ["run", "test:session"],
            cwd: "workspace",
            relativeCwd: "packages/web",
            invariant:
              "The web workspace package script must keep the session runtime valid during refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Workspace package script oracle passed.",
            failureSummary: "Workspace package script oracle failed.",
            repairHint:
              "Update packages/web/src/session.ts until the package-local test:session script passes.",
            safetyRationale:
              "Uses a workspace package.json script from packages/web for deterministic session validation.",
          },
          {
            id: "release-rollback-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-release-rollback.mjs"],
            cwd: "project",
            invariant:
              "The release migration SQL and rollback runbook must both leave the pending state.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Release rollback project oracle passed.",
            failureSummary: "Release rollback project oracle failed.",
            repairHint:
              "Update the release migration SQL and rollback runbook so both artifacts leave the pending state together.",
            safetyRationale:
              "Project-scoped deterministic oracle for the release migration and rollback bundle.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        requiredChangedPaths: [
          "packages/web/src/session.ts",
          "db/migrations/20260416_release_session_restore.sql",
          "docs/ROLLBACK.md",
        ],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex release work should prefer concrete runtime, migration, and rollback bundles even when the workspace package script and project rollback oracle already pass.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, and docs/ROLLBACK.md concrete and operator-reviewable while preserving both repo-local oracles.",
          "Treat generic release defaults or rollback wording as materially weaker even when both repo-local oracles pass.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the release migration or rollback bundle generic.",
          "Abstain if every finalist passes the oracles but keeps the release bundle too vague for operator review.",
        ],
        workstreams: [
          {
            id: "workspace-runtime",
            label: "Workspace Runtime Contract",
            goal: "Update packages/web/src/session.ts with the concrete session restore runtime behavior.",
            targetArtifacts: ["packages/web/src/session.ts"],
            requiredChangedPaths: ["packages/web/src/session.ts"],
            protectedPaths: [],
            oracleIds: ["workspace-session-test"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-migration",
            label: "Release Migration Contract",
            goal: "Update db/migrations/20260416_release_session_restore.sql with concrete release defaults.",
            targetArtifacts: ["db/migrations/20260416_release_session_restore.sql"],
            requiredChangedPaths: ["db/migrations/20260416_release_session_restore.sql"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact"],
            dependencies: ["workspace-runtime"],
            risks: ["Generic migration defaults weaken the release bundle."],
            disqualifiers: [],
          },
          {
            id: "release-rollback",
            label: "Release Rollback Contract",
            goal: "Update docs/ROLLBACK.md with concrete operator rollback steps that match the release migration.",
            targetArtifacts: ["docs/ROLLBACK.md"],
            requiredChangedPaths: ["docs/ROLLBACK.md"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact"],
            dependencies: ["release-migration"],
            risks: ["Generic rollback wording leaves the release bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "release-bundle-fit",
            label: "Release Bundle Fit",
            dependsOn: [],
            workstreamIds: ["workspace-runtime", "release-migration", "release-rollback"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/web/src/session.ts.",
              "Materially change db/migrations/20260416_release_session_restore.sql.",
              "Materially change docs/ROLLBACK.md.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "required-path-coverage",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["generic release migration bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic release migration bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "package-script-fallback-stage-guard",
    description:
      "The winner judge fails after a workspace package script oracle and a project rollback oracle both pass, so direct falls back to an incomplete finalist while the planned stage graph removes it first.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [
      { id: "workspace-session-test", roundId: "impact" },
      { id: "release-rollback-impact", roundId: "impact" },
    ],
    initialFiles() {
      return {
        "packages/web/package.json": JSON.stringify(
          {
            name: "@fixture/web",
            private: true,
            scripts: {
              "test:session": "node ./check-session-runtime.mjs",
            },
          },
          null,
          2,
        ).concat("\n"),
        "packages/web/src/session.ts":
          "export function restoreSession(request) {\n  return null;\n}\n",
        "packages/web/check-session-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("./src/session.ts", "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("workspace package runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("workspace package runtime looks valid");',
        ].join("\n"),
        "db/migrations/20260416_release_session_restore.sql":
          "-- pending release migration\nALTER TABLE sessions ADD COLUMN restore_mode TEXT;\n",
        "docs/ROLLBACK.md":
          "# Rollback\n\n- pending release rollback\n- pending operator guidance\n",
        "docs/VERIFY.md": "# Verify\n\nPlaceholder.\n",
        "tools/check-release-rollback.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          "const migration = readFileSync(",
          '  join(workspaceRoot, "db", "migrations", "20260416_release_session_restore.sql"),',
          '  "utf8",',
          ");",
          'const rollback = readFileSync(join(workspaceRoot, "docs", "ROLLBACK.md"), "utf8");',
          'if (migration.includes("pending") || rollback.includes("pending")) {',
          '  console.error("release migration or rollback bundle is still pending");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("release migration and rollback bundle cleared pending state");',
        ].join("\n"),
      };
    },
    async afterWrite(root) {
      await writeNodeBinary(
        join(root, "bin"),
        "pnpm",
        [
          'const { spawnSync } = require("node:child_process");',
          "const args = process.argv.slice(2);",
          "if (args[0] === 'run' && args[1] === 'test:session') {",
          `  const result = spawnSync(${JSON.stringify(process.execPath)}, ['check-session-runtime.mjs'], {`,
          "    cwd: process.cwd(),",
          '    stdio: "inherit",',
          "    env: process.env,",
          "  });",
          "  process.exit(result.status ?? 1);",
          "}",
          "process.stderr.write('unsupported pnpm invocation: ' + args.join(' ') + '\\n');",
          "process.exit(1);",
        ].join("\n"),
      );
    },
    taskPacket(root) {
      return {
        id: "package_script_fallback_stage_guard",
        title: "Revise the staged release bundle with fallback-safe verification",
        intent:
          "Revise packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, and docs/ROLLBACK.md into a coherent release bundle. Very complex success also requires finishing docs/VERIFY.md so fallback winner selection still sees a complete staged bundle after the repo-local oracles pass.",
        artifactKind: "code",
        targetArtifactPath: "packages/web/src/session.ts",
        nonGoals: [
          "Do not stop before docs/VERIFY.md if the release bundle must survive fallback winner selection.",
        ],
        acceptanceCriteria: [
          "packages/web/src/session.ts is materially updated.",
          "db/migrations/20260416_release_session_restore.sql is materially updated.",
          "docs/ROLLBACK.md is materially updated.",
          "docs/VERIFY.md is materially updated.",
        ],
        risks: [
          "If the judge fails, fallback should still avoid incomplete release bundles that stop before verification.",
        ],
        oracleHints: [
          "Keep the workspace package script oracle green.",
          "Keep the project-scoped release rollback oracle green.",
        ],
        strategyHints: ["Close the full staged release bundle so fallback ranking is safe."],
        contextFiles: [
          join(root, "packages", "web", "package.json"),
          join(root, "packages", "web", "src", "session.ts"),
          join(root, "packages", "web", "check-session-runtime.mjs"),
          join(root, "db", "migrations", "20260416_release_session_restore.sql"),
          join(root, "docs", "ROLLBACK.md"),
          join(root, "docs", "VERIFY.md"),
          join(root, "tools", "check-release-rollback.mjs"),
        ],
      };
    },
    analyze(root) {
      const runtime = readFileSync(join(root, "packages", "web", "src", "session.ts"), "utf8");
      const migration = readFileSync(
        join(root, "db", "migrations", "20260416_release_session_restore.sql"),
        "utf8",
      );
      const rollback = readFileSync(join(root, "docs", "ROLLBACK.md"), "utf8");
      const verify = readFileSync(join(root, "docs", "VERIFY.md"), "utf8");
      const runtimeStrong = runtime.includes("return existingSession;");
      const migrationStrong = migration.includes("existing-session");
      const rollbackStrong = rollback.includes(
        "Disable the session-restore release flag before rollback.",
      );
      const verifyStrong = verify.includes(
        "Operators can verify the fallback-safe release bundle.",
      );
      return {
        score:
          runtimeStrong && migrationStrong && rollbackStrong && verifyStrong
            ? 3
            : runtimeStrong && migrationStrong && rollbackStrong
              ? 1
              : 0,
        runtimeStrong,
        migrationStrong,
        rollbackStrong,
        verifyStrong,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "workspace-session-test",
            roundId: "impact",
            command: "pnpm",
            args: ["run", "test:session"],
            cwd: "workspace",
            relativeCwd: "packages/web",
            invariant:
              "The web workspace package script must keep the session runtime valid during refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Workspace package script oracle passed.",
            failureSummary: "Workspace package script oracle failed.",
            repairHint:
              "Update packages/web/src/session.ts until the package-local test:session script passes.",
            safetyRationale:
              "Uses a workspace package.json script from packages/web for deterministic session validation.",
          },
          {
            id: "release-rollback-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-release-rollback.mjs"],
            cwd: "project",
            invariant:
              "The release migration SQL and rollback runbook must both leave the pending state.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Release rollback project oracle passed.",
            failureSummary: "Release rollback project oracle failed.",
            repairHint:
              "Update the release migration SQL and rollback runbook so both artifacts leave the pending state together.",
            safetyRationale:
              "Project-scoped deterministic oracle for the release migration and rollback bundle.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Even fallback winner selection must not recommend an incomplete release bundle after the repo-local oracles already passed.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that close packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, docs/ROLLBACK.md, and docs/VERIFY.md as one staged release bundle.",
          "Treat finalists that stop before docs/VERIFY.md as incomplete even when both repo-local oracles pass.",
        ],
        crownGates: [
          "Do not recommend finalists that leave docs/VERIFY.md stale.",
          "Abstain if every finalist leaves the staged release verification bundle incomplete.",
        ],
        workstreams: [
          {
            id: "workspace-runtime",
            label: "Workspace Runtime Contract",
            goal: "Update packages/web/src/session.ts with the concrete session restore runtime behavior.",
            targetArtifacts: ["packages/web/src/session.ts"],
            requiredChangedPaths: ["packages/web/src/session.ts"],
            protectedPaths: [],
            oracleIds: ["workspace-session-test"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-migration",
            label: "Release Migration Contract",
            goal: "Update db/migrations/20260416_release_session_restore.sql with concrete release defaults.",
            targetArtifacts: ["db/migrations/20260416_release_session_restore.sql"],
            requiredChangedPaths: ["db/migrations/20260416_release_session_restore.sql"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact"],
            dependencies: ["workspace-runtime"],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-rollback",
            label: "Release Rollback Contract",
            goal: "Update docs/ROLLBACK.md with concrete operator rollback steps that match the release migration.",
            targetArtifacts: ["docs/ROLLBACK.md"],
            requiredChangedPaths: ["docs/ROLLBACK.md"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact"],
            dependencies: ["release-migration"],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-verify",
            label: "Release Verification Bundle",
            goal: "Finish docs/VERIFY.md so fallback winner selection still sees a complete release bundle.",
            targetArtifacts: ["docs/VERIFY.md"],
            requiredChangedPaths: ["docs/VERIFY.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["release-rollback"],
            risks: ["A missing verify bundle leaves fallback winner selection unsafe."],
            disqualifiers: ["Do not stop before the verification stage."],
          },
        ],
        stagePlan: [
          {
            id: "release-contract-fit",
            label: "Release Contract Fit",
            dependsOn: [],
            workstreamIds: ["workspace-runtime", "release-migration", "release-rollback"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/web/src/session.ts.",
              "Materially change db/migrations/20260416_release_session_restore.sql.",
              "Materially change docs/ROLLBACK.md.",
            ],
          },
          {
            id: "fallback-ready",
            label: "Fallback Ready",
            dependsOn: ["release-contract-fit"],
            workstreamIds: ["release-verify"],
            roundIds: ["impact"],
            entryCriteria: ["The release contract stage already passed."],
            exitCriteria: ["Materially change docs/VERIFY.md."],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "stage-completion",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["missing release verification stage"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["missing release verification stage", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "package-script-repair-stage-guard",
    description:
      "A repairable review-note oracle saves the weak finalist after repo-local checks pass, but the planned stage graph still removes the incomplete staged bundle before winner selection.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [
      { id: "workspace-session-test", roundId: "impact" },
      { id: "release-rollback-impact", roundId: "impact" },
      { id: "release-review-note", roundId: "impact" },
    ],
    initialFiles() {
      return {
        "packages/web/package.json": JSON.stringify(
          {
            name: "@fixture/web",
            private: true,
            scripts: {
              "test:session": "node ./check-session-runtime.mjs",
            },
          },
          null,
          2,
        ).concat("\n"),
        "packages/web/src/session.ts":
          "export function restoreSession(request) {\n  return null;\n}\n",
        "packages/web/check-session-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("./src/session.ts", "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("workspace package runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("workspace package runtime looks valid");',
        ].join("\n"),
        "db/migrations/20260416_release_session_restore.sql":
          "-- pending release migration\nALTER TABLE sessions ADD COLUMN restore_mode TEXT;\n",
        "docs/ROLLBACK.md":
          "# Rollback\n\n- pending release rollback\n- pending operator guidance\n",
        "docs/VERIFY.md": "# Verify\n\nPlaceholder.\n",
        "docs/REPAIR.md": "# Repair\n\nPlaceholder.\n",
        "tools/check-release-rollback.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          "const migration = readFileSync(",
          '  join(workspaceRoot, "db", "migrations", "20260416_release_session_restore.sql"),',
          '  "utf8",',
          ");",
          'const rollback = readFileSync(join(workspaceRoot, "docs", "ROLLBACK.md"), "utf8");',
          'if (migration.includes("pending") || rollback.includes("pending")) {',
          '  console.error("release migration or rollback bundle is still pending");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("release migration and rollback bundle cleared pending state");',
        ].join("\n"),
        "tools/check-release-review-note.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          'const reviewNote = readFileSync(join(workspaceRoot, "docs", "REPAIR.md"), "utf8");',
          'if (!reviewNote.includes("repair marker: added release review note")) {',
          '  console.error("missing repair marker");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("repair marker looks valid");',
        ].join("\n"),
      };
    },
    async afterWrite(root) {
      await writeNodeBinary(
        join(root, "bin"),
        "pnpm",
        [
          'const { spawnSync } = require("node:child_process");',
          "const args = process.argv.slice(2);",
          "if (args[0] === 'run' && args[1] === 'test:session') {",
          `  const result = spawnSync(${JSON.stringify(process.execPath)}, ['check-session-runtime.mjs'], {`,
          "    cwd: process.cwd(),",
          '    stdio: "inherit",',
          "    env: process.env,",
          "  });",
          "  process.exit(result.status ?? 1);",
          "}",
          "process.stderr.write('unsupported pnpm invocation: ' + args.join(' ') + '\\n');",
          "process.exit(1);",
        ].join("\n"),
      );
    },
    taskPacket(root) {
      return {
        id: "package_script_repair_stage_guard",
        title: "Revise the staged release bundle and repair missing review evidence when needed",
        intent:
          "Revise packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, and docs/ROLLBACK.md into a coherent release bundle. Very complex success also requires docs/VERIFY.md and a concrete release review note so the bundle remains reviewable after repairable checks.",
        artifactKind: "code",
        targetArtifactPath: "packages/web/src/session.ts",
        nonGoals: [
          "Do not rely on a repair-only review note if docs/VERIFY.md still leaves the staged release bundle incomplete.",
        ],
        acceptanceCriteria: [
          "packages/web/src/session.ts is materially updated.",
          "db/migrations/20260416_release_session_restore.sql is materially updated.",
          "docs/ROLLBACK.md is materially updated.",
          "docs/VERIFY.md is materially updated.",
        ],
        risks: [
          "A repair loop can rescue missing review evidence without fixing the deeper staged bundle gap.",
        ],
        oracleHints: [
          "Keep the workspace package script oracle green.",
          "Keep the project-scoped release rollback oracle green.",
          "The release review note can be repaired if needed.",
        ],
        strategyHints: [
          "Close the staged release bundle instead of relying only on repair output.",
        ],
        contextFiles: [
          join(root, "packages", "web", "package.json"),
          join(root, "packages", "web", "src", "session.ts"),
          join(root, "packages", "web", "check-session-runtime.mjs"),
          join(root, "db", "migrations", "20260416_release_session_restore.sql"),
          join(root, "docs", "ROLLBACK.md"),
          join(root, "docs", "VERIFY.md"),
          join(root, "docs", "REPAIR.md"),
          join(root, "tools", "check-release-rollback.mjs"),
          join(root, "tools", "check-release-review-note.mjs"),
        ],
      };
    },
    analyze(root) {
      const runtime = readFileSync(join(root, "packages", "web", "src", "session.ts"), "utf8");
      const migration = readFileSync(
        join(root, "db", "migrations", "20260416_release_session_restore.sql"),
        "utf8",
      );
      const rollback = readFileSync(join(root, "docs", "ROLLBACK.md"), "utf8");
      const verify = readFileSync(join(root, "docs", "VERIFY.md"), "utf8");
      const runtimeStrong = runtime.includes("return existingSession;");
      const migrationStrong = migration.includes("existing-session");
      const rollbackStrong = rollback.includes(
        "Disable the session-restore release flag before rollback.",
      );
      const verifyStrong = verify.includes(
        "Operators can verify the repaired release bundle end to end.",
      );
      return {
        score:
          runtimeStrong && migrationStrong && rollbackStrong && verifyStrong
            ? 3
            : runtimeStrong && migrationStrong && rollbackStrong
              ? 1
              : 0,
        runtimeStrong,
        migrationStrong,
        rollbackStrong,
        verifyStrong,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "workspace-session-test",
            roundId: "impact",
            command: "pnpm",
            args: ["run", "test:session"],
            cwd: "workspace",
            relativeCwd: "packages/web",
            invariant:
              "The web workspace package script must keep the session runtime valid during refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Workspace package script oracle passed.",
            failureSummary: "Workspace package script oracle failed.",
            repairHint:
              "Update packages/web/src/session.ts until the package-local test:session script passes.",
            safetyRationale:
              "Uses a workspace package.json script from packages/web for deterministic session validation.",
          },
          {
            id: "release-rollback-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-release-rollback.mjs"],
            cwd: "project",
            invariant:
              "The release migration SQL and rollback runbook must both leave the pending state.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Release rollback project oracle passed.",
            failureSummary: "Release rollback project oracle failed.",
            repairHint:
              "Update the release migration SQL and rollback runbook so both artifacts leave the pending state together.",
            safetyRationale:
              "Project-scoped deterministic oracle for the release migration and rollback bundle.",
          },
          {
            id: "release-review-note",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-release-review-note.mjs"],
            cwd: "project",
            invariant:
              "The release bundle must include a concrete repair/review note once the runtime and rollback artifacts are ready.",
            enforcement: "repairable",
            confidence: "high",
            passSummary: "Release review note oracle passed.",
            failureSummary: "Release review note oracle failed.",
            repairHint: "Produce the missing release review note with the repair marker.",
            safetyRationale:
              "Project-scoped repairable oracle for deterministic release review evidence.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        decisionDrivers: [
          ...plan.decisionDrivers,
          "A repair loop may rescue missing review evidence, but complex release work is still incomplete until the verification stage closes.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that close packages/web/src/session.ts, db/migrations/20260416_release_session_restore.sql, docs/ROLLBACK.md, and docs/VERIFY.md as one staged release bundle.",
          "Treat finalists that only repair docs/REPAIR.md while leaving docs/VERIFY.md stale as incomplete.",
        ],
        crownGates: [
          "Do not recommend finalists that leave docs/VERIFY.md stale even if repairable oracles recovered.",
          "Abstain if every finalist relies on repair-only evidence while the staged release bundle remains incomplete.",
        ],
        workstreams: [
          {
            id: "workspace-runtime",
            label: "Workspace Runtime Contract",
            goal: "Update packages/web/src/session.ts with the concrete session restore runtime behavior.",
            targetArtifacts: ["packages/web/src/session.ts"],
            requiredChangedPaths: ["packages/web/src/session.ts"],
            protectedPaths: [],
            oracleIds: ["workspace-session-test"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-migration",
            label: "Release Migration Contract",
            goal: "Update db/migrations/20260416_release_session_restore.sql with concrete release defaults.",
            targetArtifacts: ["db/migrations/20260416_release_session_restore.sql"],
            requiredChangedPaths: ["db/migrations/20260416_release_session_restore.sql"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact"],
            dependencies: ["workspace-runtime"],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-rollback",
            label: "Release Rollback Contract",
            goal: "Update docs/ROLLBACK.md with concrete operator rollback steps that match the release migration.",
            targetArtifacts: ["docs/ROLLBACK.md"],
            requiredChangedPaths: ["docs/ROLLBACK.md"],
            protectedPaths: [],
            oracleIds: ["release-rollback-impact", "release-review-note"],
            dependencies: ["release-migration"],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "release-verify",
            label: "Release Verification Bundle",
            goal: "Finish docs/VERIFY.md so the repaired release bundle is still fully reviewable.",
            targetArtifacts: ["docs/VERIFY.md"],
            requiredChangedPaths: ["docs/VERIFY.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["release-rollback"],
            risks: ["A missing verify bundle leaves a repaired finalist incomplete."],
            disqualifiers: ["Do not stop at repair-only evidence."],
          },
        ],
        stagePlan: [
          {
            id: "release-contract-fit",
            label: "Release Contract Fit",
            dependsOn: [],
            workstreamIds: ["workspace-runtime", "release-migration", "release-rollback"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/web/src/session.ts.",
              "Materially change db/migrations/20260416_release_session_restore.sql.",
              "Materially change docs/ROLLBACK.md.",
            ],
          },
          {
            id: "repair-aware-verify",
            label: "Repair Aware Verify",
            dependsOn: ["release-contract-fit"],
            workstreamIds: ["release-verify"],
            roundIds: ["impact"],
            entryCriteria: [
              "The release contract stage already passed, including any repair loop needed for review evidence.",
            ],
            exitCriteria: ["Materially change docs/VERIFY.md."],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "stage-completion",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["repair-only release bundle", "missing release verification stage"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: [
            "repair-only release bundle",
            "missing release verification stage",
            "weak-finalist-evidence",
          ],
        },
      };
    },
  },
];
