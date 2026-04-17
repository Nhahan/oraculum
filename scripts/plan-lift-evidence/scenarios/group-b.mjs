import { readFileSync } from "node:fs";
import { join } from "node:path";

export const scenarioGroupB = [
  {
    id: "package-oracle-code-test-contract",
    description:
      "A package-scoped repo-local oracle validates runtime semantics, but only the strong candidate also updates the paired regression test artifact.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [{ id: "auth-runtime-impact", roundId: "impact" }],
    initialFiles() {
      return {
        "packages/auth/src/session.ts":
          "export function restoreSession(request) {\n  return null;\n}\n",
        "packages/auth/test/session-refresh.test.ts":
          'import { restoreSession } from "../src/session";\n\ntest("restoreSession keeps the signed-in user across refresh", () => {\n  // TODO add the regression expectation.\n});\n',
        "packages/auth/check-session-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          'const source = readFileSync(join(workspaceRoot, "packages", "auth", "src", "session.ts"), "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("session runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("session runtime bundle looks valid");',
        ].join("\n"),
      };
    },
    taskPacket(root) {
      return {
        id: "package_oracle_code_test_bundle",
        title: "Revise the package runtime and regression bundle for session restore",
        intent:
          "Revise packages/auth/src/session.ts into the canonical refresh restore implementation. Very complex success also requires updating packages/auth/test/session-refresh.test.ts so the regression contract matches the runtime behavior.",
        artifactKind: "code",
        targetArtifactPath: "packages/auth/src/session.ts",
        nonGoals: [
          "Do not stop after the implementation change if packages/auth/test/session-refresh.test.ts stays stale.",
        ],
        acceptanceCriteria: [
          "packages/auth/src/session.ts restores the existing session on refresh.",
          "packages/auth/test/session-refresh.test.ts records the concrete regression expectation.",
        ],
        risks: ["A code-only change leaves the regression contract stale."],
        oracleHints: ["Keep the package-local runtime oracle green."],
        strategyHints: ["Keep the runtime implementation and regression test aligned."],
        contextFiles: [
          join(root, "packages", "auth", "src", "session.ts"),
          join(root, "packages", "auth", "test", "session-refresh.test.ts"),
          join(root, "packages", "auth", "check-session-runtime.mjs"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(
        join(root, "packages", "auth", "src", "session.ts"),
        "utf8",
      );
      const regression = readFileSync(
        join(root, "packages", "auth", "test", "session-refresh.test.ts"),
        "utf8",
      );
      const implementationStrong = implementation.includes("return existingSession;");
      const regressionStrong = regression.includes(
        "expect(restoreSession(request)).toEqual(existingSession);",
      );
      return {
        score: implementationStrong && regressionStrong ? 3 : implementationStrong ? 1 : 0,
        implementationStrong,
        regressionStrong,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "auth-runtime-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["check-session-runtime.mjs"],
            cwd: "project",
            relativeCwd: "packages/auth",
            invariant:
              "The auth package runtime must restore the existing session during a normal refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Auth package runtime oracle passed.",
            failureSummary: "Auth package runtime oracle failed.",
            repairHint:
              "Update packages/auth/src/session.ts so the package-level session runtime check passes.",
            safetyRationale: "Package-local deterministic runtime oracle for the auth workspace.",
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
          "Complex package work must keep the implementation and regression test bundle in sync while preserving the package-local runtime oracle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both packages/auth/src/session.ts and packages/auth/test/session-refresh.test.ts coherently.",
          "Treat implementation-only changes as incomplete because the regression contract remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that leave packages/auth/test/session-refresh.test.ts stale.",
          "Abstain if every finalist changes the implementation but not the paired regression test artifact.",
        ],
        workstreams: [
          {
            id: "runtime-implementation",
            label: "Runtime Implementation Contract",
            goal: "Update packages/auth/src/session.ts with the session restore implementation.",
            targetArtifacts: ["packages/auth/src/session.ts"],
            requiredChangedPaths: ["packages/auth/src/session.ts"],
            protectedPaths: [],
            oracleIds: ["auth-runtime-impact"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "regression-test",
            label: "Regression Test Contract",
            goal: "Update packages/auth/test/session-refresh.test.ts with the concrete regression expectation.",
            targetArtifacts: ["packages/auth/test/session-refresh.test.ts"],
            requiredChangedPaths: ["packages/auth/test/session-refresh.test.ts"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["runtime-implementation"],
            risks: ["A stale regression test leaves the runtime bundle weak."],
            disqualifiers: ["Do not leave packages/auth/test/session-refresh.test.ts unchanged."],
          },
        ],
        stagePlan: [
          {
            id: "code-test-fit",
            label: "Code Test Fit",
            dependsOn: [],
            workstreamIds: ["runtime-implementation", "regression-test"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/auth/src/session.ts.",
              "Materially change packages/auth/test/session-refresh.test.ts.",
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
          abstentionTriggers: ["stale regression test contract"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["stale regression test contract", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "api-schema-reviewability-bias",
    description:
      "Both candidates satisfy the handler and schema file contract, but only the strong candidate leaves a concrete, operator-reviewable API bundle.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "services/http/session_handler.py":
          'def build_session_response(request):\n    return {"status": "pending"}\n',
        "api/openapi/session.yaml": "status: pending\nlogout_behavior: review-later\n",
      };
    },
    taskPacket(root) {
      return {
        id: "api_schema_reviewability",
        title: "Revise the reviewable handler and API schema bundle",
        intent:
          "Revise services/http/session_handler.py and api/openapi/session.yaml into a coherent API bundle. Very complex success prefers concrete, operator-reviewable runtime and schema semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "services/http/session_handler.py",
        nonGoals: ["Do not leave the handler and schema bundle at generic wording."],
        acceptanceCriteria: [
          "services/http/session_handler.py is materially updated.",
          "api/openapi/session.yaml is materially updated.",
        ],
        risks: [
          "Generic API wording makes the handler and schema bundle weakly reviewable even when both files changed.",
        ],
        oracleHints: [],
        strategyHints: ["Prefer concrete handler behavior and concrete API schema markers."],
        contextFiles: [
          join(root, "services", "http", "session_handler.py"),
          join(root, "api", "openapi", "session.yaml"),
        ],
      };
    },
    analyze(root) {
      const handler = readFileSync(join(root, "services", "http", "session_handler.py"), "utf8");
      const schema = readFileSync(join(root, "api", "openapi", "session.yaml"), "utf8");
      const handlerSpecific =
        handler.includes('"status": "restored"') &&
        handler.includes('"logout_behavior": "clears-on-next-load"');
      const schemaSpecific =
        schema.includes("status: restored") &&
        schema.includes("logout_behavior: clears-on-next-load");
      return {
        score: handlerSpecific && schemaSpecific ? 3 : 1,
        handlerSpecific,
        schemaSpecific,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        requiredChangedPaths: ["services/http/session_handler.py", "api/openapi/session.yaml"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex API work should prefer concrete, reviewable handler and schema bundles over generic rewrites.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make services/http/session_handler.py and api/openapi/session.yaml concrete and operator-reviewable.",
          "Treat generic API wording as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the handler and schema bundle generic.",
          "Abstain if every finalist changes both files but keeps the API semantics too vague for review.",
        ],
        workstreams: [
          {
            id: "handler-runtime",
            label: "Handler Runtime Contract",
            goal: "Update services/http/session_handler.py with a concrete session restore response.",
            targetArtifacts: ["services/http/session_handler.py"],
            requiredChangedPaths: ["services/http/session_handler.py"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "openapi-schema",
            label: "OpenAPI Schema Contract",
            goal: "Update api/openapi/session.yaml with concrete schema markers that match the handler response.",
            targetArtifacts: ["api/openapi/session.yaml"],
            requiredChangedPaths: ["api/openapi/session.yaml"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["handler-runtime"],
            risks: ["Generic schema wording keeps the API bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "api-schema-fit",
            label: "API Schema Fit",
            dependsOn: [],
            workstreamIds: ["handler-runtime", "openapi-schema"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change services/http/session_handler.py.",
              "Materially change api/openapi/session.yaml.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic API bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic API bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "project-oracle-api-schema-reviewability",
    description:
      "A project-scoped repo-local oracle validates the handler and schema bundle, but only the strong candidate leaves a concrete, operator-reviewable API result.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [{ id: "session-api-impact", roundId: "impact" }],
    initialFiles() {
      return {
        "services/http/session_handler.py":
          'def build_session_response(request):\n    return {"status": "pending"}\n',
        "api/openapi/session.yaml": "status: pending\nlogout_behavior: pending\n",
        "tools/check-session-api.mjs": [
          'import { readFileSync } from "node:fs";',
          'import { join } from "node:path";',
          "",
          "const workspaceRoot = process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR ?? process.cwd();",
          'const handler = readFileSync(join(workspaceRoot, "services", "http", "session_handler.py"), "utf8");',
          'const schema = readFileSync(join(workspaceRoot, "api", "openapi", "session.yaml"), "utf8");',
          'if (handler.includes("pending") || schema.includes("pending")) {',
          '  console.error("handler or schema is still pending");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("handler and schema are no longer pending");',
        ].join("\n"),
      };
    },
    taskPacket(root) {
      return {
        id: "project_oracle_api_schema_reviewability",
        title: "Revise the reviewable handler and API schema bundle",
        intent:
          "Revise services/http/session_handler.py and api/openapi/session.yaml into a coherent API bundle. Very complex success prefers concrete, operator-reviewable runtime and schema semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "services/http/session_handler.py",
        nonGoals: ["Do not leave the handler and schema bundle at generic wording."],
        acceptanceCriteria: [
          "services/http/session_handler.py is materially updated.",
          "api/openapi/session.yaml is materially updated.",
        ],
        risks: [
          "Generic API wording makes the handler and schema bundle weakly reviewable even when both files changed.",
        ],
        oracleHints: ["Keep the project-level API bundle oracle green."],
        strategyHints: ["Prefer concrete handler behavior and concrete API schema markers."],
        contextFiles: [
          join(root, "services", "http", "session_handler.py"),
          join(root, "api", "openapi", "session.yaml"),
          join(root, "tools", "check-session-api.mjs"),
        ],
      };
    },
    analyze(root) {
      const handler = readFileSync(join(root, "services", "http", "session_handler.py"), "utf8");
      const schema = readFileSync(join(root, "api", "openapi", "session.yaml"), "utf8");
      const handlerSpecific =
        handler.includes('"status": "restored"') &&
        handler.includes('"logout_behavior": "clears-on-next-load"');
      const schemaSpecific =
        schema.includes("status: restored") &&
        schema.includes("logout_behavior: clears-on-next-load");
      return {
        score: handlerSpecific && schemaSpecific ? 3 : 1,
        handlerSpecific,
        schemaSpecific,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "session-api-impact",
            roundId: "impact",
            command: process.execPath,
            args: ["tools/check-session-api.mjs"],
            cwd: "project",
            invariant:
              "The session handler and API schema must both move out of the pending state.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Project API bundle oracle passed.",
            failureSummary: "Project API bundle oracle failed.",
            repairHint:
              "Update the handler and schema so both artifacts leave the pending state together.",
            safetyRationale: "Project-scoped deterministic API bundle oracle for the fixture.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        requiredChangedPaths: ["services/http/session_handler.py", "api/openapi/session.yaml"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex API work should prefer concrete, reviewable handler and schema bundles over generic rewrites while preserving the project API oracle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make services/http/session_handler.py and api/openapi/session.yaml concrete and operator-reviewable.",
          "Treat generic API wording as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the handler and schema bundle generic.",
          "Abstain if every finalist changes both files but keeps the API semantics too vague for review.",
        ],
        workstreams: [
          {
            id: "handler-runtime",
            label: "Handler Runtime Contract",
            goal: "Update services/http/session_handler.py with a concrete session restore response.",
            targetArtifacts: ["services/http/session_handler.py"],
            requiredChangedPaths: ["services/http/session_handler.py"],
            protectedPaths: [],
            oracleIds: ["session-api-impact"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "openapi-schema",
            label: "OpenAPI Schema Contract",
            goal: "Update api/openapi/session.yaml with concrete schema markers that match the handler response.",
            targetArtifacts: ["api/openapi/session.yaml"],
            requiredChangedPaths: ["api/openapi/session.yaml"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["handler-runtime"],
            risks: ["Generic schema wording keeps the API bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "api-schema-fit",
            label: "API Schema Fit",
            dependsOn: [],
            workstreamIds: ["handler-runtime", "openapi-schema"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change services/http/session_handler.py.",
              "Materially change api/openapi/session.yaml.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic API bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic API bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "workspace-oracle-package-config-contract",
    description:
      "A workspace-scoped package oracle validates the package runtime, but only the strong candidate also updates the paired package config artifact.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [{ id: "billing-runtime-workspace", roundId: "impact" }],
    initialFiles() {
      return {
        "packages/billing/src/reconcile.ts":
          "export function reconcileRestore(request) {\n  return null;\n}\n",
        "packages/billing/config/reconcile.json":
          '{\n  "restoreMode": "pending",\n  "logoutBehavior": "pending"\n}\n',
        "packages/billing/check-reconcile-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("src/reconcile.ts", "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("billing runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("billing runtime bundle looks valid");',
        ].join("\n"),
      };
    },
    taskPacket(root) {
      return {
        id: "workspace_oracle_package_config_bundle",
        title: "Revise the package runtime and config bundle for billing session restore",
        intent:
          "Revise packages/billing/src/reconcile.ts into the canonical refresh restore implementation. Very complex success also requires updating packages/billing/config/reconcile.json so the package config matches the runtime behavior.",
        artifactKind: "code",
        targetArtifactPath: "packages/billing/src/reconcile.ts",
        nonGoals: [
          "Do not stop after the implementation change if packages/billing/config/reconcile.json stays stale.",
        ],
        acceptanceCriteria: [
          "packages/billing/src/reconcile.ts restores the existing billing session on refresh.",
          "packages/billing/config/reconcile.json records the concrete package runtime contract.",
        ],
        risks: ["A code-only change leaves the package config contract stale."],
        oracleHints: ["Keep the workspace-scoped billing runtime oracle green."],
        strategyHints: ["Keep the package runtime implementation and config aligned."],
        contextFiles: [
          join(root, "packages", "billing", "src", "reconcile.ts"),
          join(root, "packages", "billing", "config", "reconcile.json"),
          join(root, "packages", "billing", "check-reconcile-runtime.mjs"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(
        join(root, "packages", "billing", "src", "reconcile.ts"),
        "utf8",
      );
      const config = readFileSync(
        join(root, "packages", "billing", "config", "reconcile.json"),
        "utf8",
      );
      const implementationStrong = implementation.includes("return existingSession;");
      const configStrong =
        config.includes('"restoreMode": "existing-session"') &&
        config.includes('"logoutBehavior": "clears-on-next-load"');
      return {
        score: implementationStrong && configStrong ? 3 : implementationStrong ? 1 : 0,
        implementationStrong,
        configStrong,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "billing-runtime-workspace",
            roundId: "impact",
            command: process.execPath,
            args: ["check-reconcile-runtime.mjs"],
            cwd: "workspace",
            relativeCwd: "packages/billing",
            invariant:
              "The billing package runtime must restore the existing session during a normal refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Billing package runtime oracle passed.",
            failureSummary: "Billing package runtime oracle failed.",
            repairHint:
              "Update packages/billing/src/reconcile.ts so the package-level billing runtime check passes.",
            safetyRationale:
              "Workspace-scoped deterministic runtime oracle for the billing package workspace.",
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
          "Complex package work must keep the billing runtime implementation and package config bundle in sync while preserving the workspace-scoped package oracle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both packages/billing/src/reconcile.ts and packages/billing/config/reconcile.json coherently.",
          "Treat implementation-only changes as incomplete because the package config contract remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that leave packages/billing/config/reconcile.json stale.",
          "Abstain if every finalist changes the implementation but not the paired package config artifact.",
        ],
        workstreams: [
          {
            id: "billing-runtime",
            label: "Billing Runtime Contract",
            goal: "Update packages/billing/src/reconcile.ts with the billing session restore implementation.",
            targetArtifacts: ["packages/billing/src/reconcile.ts"],
            requiredChangedPaths: ["packages/billing/src/reconcile.ts"],
            protectedPaths: [],
            oracleIds: ["billing-runtime-workspace"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "billing-config",
            label: "Billing Config Contract",
            goal: "Update packages/billing/config/reconcile.json with the concrete package runtime contract.",
            targetArtifacts: ["packages/billing/config/reconcile.json"],
            requiredChangedPaths: ["packages/billing/config/reconcile.json"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["billing-runtime"],
            risks: ["A stale package config leaves the billing bundle weak."],
            disqualifiers: ["Do not leave packages/billing/config/reconcile.json unchanged."],
          },
        ],
        stagePlan: [
          {
            id: "billing-config-fit",
            label: "Billing Config Fit",
            dependsOn: [],
            workstreamIds: ["billing-runtime", "billing-config"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/billing/src/reconcile.ts.",
              "Materially change packages/billing/config/reconcile.json.",
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
          abstentionTriggers: ["stale billing package config contract"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: [
            "stale billing package config contract",
            "weak-finalist-evidence",
          ],
        },
      };
    },
  },

  {
    id: "workspace-oracle-package-config-reviewability",
    description:
      "A workspace-scoped package oracle validates the package runtime, but only the strong candidate leaves a concrete, operator-reviewable package runtime bundle.",
    weakCandidateId: "cand-01",
    expectedRepoOracles: [{ id: "billing-runtime-workspace", roundId: "impact" }],
    initialFiles() {
      return {
        "packages/billing/src/reconcile.ts":
          "export function reconcileRestore(request) {\n  return null;\n}\n",
        "packages/billing/config/reconcile.json":
          '{\n  "restoreMode": "pending",\n  "logoutBehavior": "pending"\n}\n',
        "packages/billing/check-reconcile-runtime.mjs": [
          'import { readFileSync } from "node:fs";',
          "",
          'const source = readFileSync("src/reconcile.ts", "utf8");',
          'if (!source.includes("return existingSession;")) {',
          '  console.error("billing runtime is still stale");',
          "  process.exit(1);",
          "}",
          "",
          'console.log("billing runtime bundle looks valid");',
        ].join("\n"),
      };
    },
    taskPacket(root) {
      return {
        id: "workspace_oracle_package_config_reviewability",
        title:
          "Revise the reviewable package runtime and config bundle for billing session restore",
        intent:
          "Revise packages/billing/src/reconcile.ts and packages/billing/config/reconcile.json into a coherent billing package bundle. Very complex success prefers concrete, operator-reviewable runtime and config semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "packages/billing/src/reconcile.ts",
        nonGoals: ["Do not leave the billing package bundle at generic wording."],
        acceptanceCriteria: [
          "packages/billing/src/reconcile.ts is materially updated.",
          "packages/billing/config/reconcile.json is materially updated.",
        ],
        risks: [
          "Generic package wording makes the runtime bundle weakly reviewable even when both files changed.",
        ],
        oracleHints: ["Keep the workspace-scoped billing runtime oracle green."],
        strategyHints: ["Prefer concrete package runtime behavior and config markers."],
        contextFiles: [
          join(root, "packages", "billing", "src", "reconcile.ts"),
          join(root, "packages", "billing", "config", "reconcile.json"),
          join(root, "packages", "billing", "check-reconcile-runtime.mjs"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(
        join(root, "packages", "billing", "src", "reconcile.ts"),
        "utf8",
      );
      const config = readFileSync(
        join(root, "packages", "billing", "config", "reconcile.json"),
        "utf8",
      );
      const implementationSpecific =
        implementation.includes("return existingSession;") &&
        implementation.includes("if (!existingSession)");
      const configSpecific =
        config.includes('"restoreMode": "existing-session"') &&
        config.includes('"logoutBehavior": "clears-on-next-load"');
      return {
        score: implementationSpecific && configSpecific ? 3 : 1,
        implementationSpecific,
        configSpecific,
      };
    },
    advancedConfig() {
      return {
        version: 1,
        oracles: [
          {
            id: "billing-runtime-workspace",
            roundId: "impact",
            command: process.execPath,
            args: ["check-reconcile-runtime.mjs"],
            cwd: "workspace",
            relativeCwd: "packages/billing",
            invariant:
              "The billing package runtime must restore the existing session during a normal refresh.",
            enforcement: "hard",
            confidence: "high",
            passSummary: "Billing package runtime oracle passed.",
            failureSummary: "Billing package runtime oracle failed.",
            repairHint:
              "Update packages/billing/src/reconcile.ts so the package-level billing runtime check passes.",
            safetyRationale:
              "Workspace-scoped deterministic runtime oracle for the billing package workspace.",
          },
        ],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        requiredChangedPaths: [
          "packages/billing/src/reconcile.ts",
          "packages/billing/config/reconcile.json",
        ],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex package work should prefer concrete, reviewable billing runtime and config bundles while preserving the workspace-scoped package oracle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make packages/billing/src/reconcile.ts and packages/billing/config/reconcile.json concrete and operator-reviewable.",
          "Treat generic package wording as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the billing package runtime bundle generic.",
          "Abstain if every finalist changes both files but keeps the runtime semantics too vague for review.",
        ],
        workstreams: [
          {
            id: "billing-runtime",
            label: "Billing Runtime Contract",
            goal: "Update packages/billing/src/reconcile.ts with a concrete billing session restore response.",
            targetArtifacts: ["packages/billing/src/reconcile.ts"],
            requiredChangedPaths: ["packages/billing/src/reconcile.ts"],
            protectedPaths: [],
            oracleIds: ["billing-runtime-workspace"],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "billing-config",
            label: "Billing Config Contract",
            goal: "Update packages/billing/config/reconcile.json with concrete config markers that match the runtime behavior.",
            targetArtifacts: ["packages/billing/config/reconcile.json"],
            requiredChangedPaths: ["packages/billing/config/reconcile.json"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["billing-runtime"],
            risks: ["Generic config wording keeps the billing package bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "billing-reviewability-fit",
            label: "Billing Reviewability Fit",
            dependsOn: [],
            workstreamIds: ["billing-runtime", "billing-config"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change packages/billing/src/reconcile.ts.",
              "Materially change packages/billing/config/reconcile.json.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "artifact-coherence",
            "required-path-coverage",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["generic billing package bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic billing package bundle", "weak-finalist-evidence"],
        },
      };
    },
  },
];
