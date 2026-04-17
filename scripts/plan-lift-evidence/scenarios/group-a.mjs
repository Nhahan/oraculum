import { readFileSync } from "node:fs";
import { join } from "node:path";

export const scenarioGroupA = [
  {
    id: "fallback-policy-stage-guard",
    description:
      "The winner judge fails, so direct consult falls back to the lexicographically first finalist while the planned stage graph removes the incomplete finalist first.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/OPS.md": "# Ops\n\nPlaceholder.\n",
        "docs/VERIFY.md": "# Verify\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "fallback_stage_bundle",
        title: "Revise the staged operations bundle",
        intent:
          "Revise docs/OPS.md into the session restore operations contract. Very complex success also requires grounding the ops contract in docs/PRD.md and finishing docs/VERIFY.md so fallback winner selection still sees a complete staged bundle.",
        artifactKind: "document",
        targetArtifactPath: "docs/OPS.md",
        nonGoals: ["Do not stop after the first staged contract if docs/VERIFY.md remains stale."],
        acceptanceCriteria: [
          "docs/OPS.md is materially updated.",
          "The staged operations bundle ends with docs/VERIFY.md.",
        ],
        risks: ["If the judge fails, fallback should still avoid incomplete staged bundles."],
        oracleHints: [],
        strategyHints: ["Close the full staged bundle so fallback ranking is safe."],
        contextFiles: [
          join(root, "docs", "PRD.md"),
          join(root, "docs", "OPS.md"),
          join(root, "docs", "VERIFY.md"),
        ],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const ops = readFileSync(join(root, "docs", "OPS.md"), "utf8");
      const verify = readFileSync(join(root, "docs", "VERIFY.md"), "utf8");
      const prdStrong = prd.includes("canonical session contract");
      const opsStrong = ops.includes("session restore operations contract");
      const verifyStrong = verify.includes("Operators can verify the fallback-safe staged bundle.");
      return {
        score: prdStrong && opsStrong && verifyStrong ? 3 : prdStrong && opsStrong ? 1 : 0,
        prdStrong,
        opsStrong,
        verifyStrong,
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
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Even fallback winner selection must not recommend an incomplete staged operations bundle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that close docs/PRD.md, docs/OPS.md, and docs/VERIFY.md as one staged operations bundle.",
          "Treat finalists that stop before docs/VERIFY.md as incomplete.",
        ],
        crownGates: [
          "Do not recommend finalists that leave docs/VERIFY.md stale.",
          "Abstain if every finalist leaves the staged verification bundle incomplete.",
        ],
        workstreams: [
          {
            id: "canonical-prd",
            label: "Canonical PRD",
            goal: "Update docs/PRD.md so the operations bundle stays grounded in the canonical contract.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "ops-contract",
            label: "Operations Contract",
            goal: "Update docs/OPS.md with the session restore operations contract.",
            targetArtifacts: ["docs/OPS.md"],
            requiredChangedPaths: ["docs/OPS.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["canonical-prd"],
            risks: ["An ops contract without the canonical PRD remains weak."],
            disqualifiers: [],
          },
          {
            id: "verification-bundle",
            label: "Verification Bundle",
            goal: "Finish docs/VERIFY.md so fallback winner selection still sees a reviewable staged bundle.",
            targetArtifacts: ["docs/VERIFY.md"],
            requiredChangedPaths: ["docs/VERIFY.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["ops-contract"],
            risks: ["A missing verify bundle leaves fallback winner selection unsafe."],
            disqualifiers: ["Do not stop before the verification stage."],
          },
        ],
        stagePlan: [
          {
            id: "contract-fit",
            label: "Contract Fit",
            dependsOn: [],
            workstreamIds: ["canonical-prd", "ops-contract"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: ["Materially change docs/PRD.md.", "Materially change docs/OPS.md."],
          },
          {
            id: "fallback-ready",
            label: "Fallback Ready",
            dependsOn: ["contract-fit"],
            workstreamIds: ["verification-bundle"],
            roundIds: ["impact"],
            entryCriteria: ["The staged contract fit already passed."],
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
          abstentionTriggers: ["missing fallback verification stage"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["missing fallback verification stage", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "code-config-contract-coverage",
    description:
      "The weak candidate updates only the Python implementation while the strong candidate also updates the paired session config artifact.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "src/session.py": "def restore_session(request):\n    return None\n",
        "config/session.yaml": "restore_on_refresh: false\nlogout_clears_on_next_load: false\n",
      };
    },
    taskPacket(root) {
      return {
        id: "code_config_bundle",
        title: "Revise the session restore implementation bundle",
        intent:
          "Revise src/session.py into the canonical session restore implementation. Very complex success also requires updating config/session.yaml so the runtime configuration matches the new implementation contract.",
        artifactKind: "code",
        targetArtifactPath: "src/session.py",
        nonGoals: [
          "Do not stop after the Python implementation if config/session.yaml stays stale.",
        ],
        acceptanceCriteria: [
          "src/session.py implements the session restore behavior.",
          "config/session.yaml matches the runtime contract.",
        ],
        risks: ["A code-only change leaves the runtime configuration inconsistent."],
        oracleHints: [],
        strategyHints: ["Keep the Python implementation and runtime config aligned."],
        contextFiles: [join(root, "src", "session.py"), join(root, "config", "session.yaml")],
      };
    },
    analyze(root) {
      const implementation = readFileSync(join(root, "src", "session.py"), "utf8");
      const config = readFileSync(join(root, "config", "session.yaml"), "utf8");
      const codeStrong = implementation.includes("return existing_session");
      const configStrong =
        config.includes("restore_on_refresh: true") &&
        config.includes("logout_clears_on_next_load: true");
      return {
        score: codeStrong && configStrong ? 3 : codeStrong ? 1 : 0,
        codeStrong,
        configStrong,
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
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex runtime work must keep the Python implementation and session config in sync.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both src/session.py and config/session.yaml coherently.",
          "Treat code-only changes as incomplete because the runtime config remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that leave config/session.yaml stale.",
          "Abstain if every finalist changes the implementation but not the paired config.",
        ],
        workstreams: [
          {
            id: "python-runtime",
            label: "Python Runtime Contract",
            goal: "Update src/session.py with the session restore implementation.",
            targetArtifacts: ["src/session.py"],
            requiredChangedPaths: ["src/session.py"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "runtime-config",
            label: "Runtime Config Contract",
            goal: "Update config/session.yaml so the runtime configuration matches the Python implementation.",
            targetArtifacts: ["config/session.yaml"],
            requiredChangedPaths: ["config/session.yaml"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["python-runtime"],
            risks: ["A stale config leaves the implementation contract incomplete at runtime."],
            disqualifiers: ["Do not leave config/session.yaml unchanged."],
          },
        ],
        stagePlan: [
          {
            id: "runtime-fit",
            label: "Runtime Fit",
            dependsOn: [],
            workstreamIds: ["python-runtime", "runtime-config"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change src/session.py.",
              "Materially change config/session.yaml.",
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
          abstentionTriggers: ["stale runtime config"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["stale runtime config", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "polyglot-contract-coverage",
    description:
      "The weak candidate updates only the Python service while the strong candidate also updates the paired Go status artifact.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "services/api/app.py": "def restore_session(request):\n    return None\n",
        "internal/status/status.go":
          'package status\n\nconst SessionRestoreStatus = "SessionRestorePending"\n',
      };
    },
    taskPacket(root) {
      return {
        id: "polyglot_contract_bundle",
        title: "Revise the polyglot session restore bundle",
        intent:
          "Revise services/api/app.py into the canonical session restore implementation. Very complex success also requires updating internal/status/status.go so the cross-language status artifact matches the runtime behavior.",
        artifactKind: "code",
        targetArtifactPath: "services/api/app.py",
        nonGoals: [
          "Do not stop after the Python implementation if internal/status/status.go stays stale.",
        ],
        acceptanceCriteria: [
          "services/api/app.py implements the session restore behavior.",
          "internal/status/status.go matches the cross-language runtime contract.",
        ],
        risks: ["A Python-only change leaves the Go status contract stale."],
        oracleHints: [],
        strategyHints: ["Keep the Python runtime and Go status artifacts aligned."],
        contextFiles: [
          join(root, "services", "api", "app.py"),
          join(root, "internal", "status", "status.go"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(join(root, "services", "api", "app.py"), "utf8");
      const status = readFileSync(join(root, "internal", "status", "status.go"), "utf8");
      const pythonStrong = implementation.includes("return existing_session");
      const goStrong = status.includes("SessionRestored");
      return {
        score: pythonStrong && goStrong ? 3 : pythonStrong ? 1 : 0,
        pythonStrong,
        goStrong,
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
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex polyglot runtime work must keep the Python implementation and Go status artifact in sync.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both services/api/app.py and internal/status/status.go coherently.",
          "Treat Python-only changes as incomplete because the Go status contract remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that leave internal/status/status.go stale.",
          "Abstain if every finalist changes the Python implementation but not the paired Go status artifact.",
        ],
        workstreams: [
          {
            id: "python-runtime",
            label: "Python Runtime Contract",
            goal: "Update services/api/app.py with the session restore implementation.",
            targetArtifacts: ["services/api/app.py"],
            requiredChangedPaths: ["services/api/app.py"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "go-status",
            label: "Go Status Contract",
            goal: "Update internal/status/status.go so the status artifact matches the runtime behavior.",
            targetArtifacts: ["internal/status/status.go"],
            requiredChangedPaths: ["internal/status/status.go"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["python-runtime"],
            risks: ["A stale Go status artifact leaves the cross-language contract incomplete."],
            disqualifiers: ["Do not leave internal/status/status.go unchanged."],
          },
        ],
        stagePlan: [
          {
            id: "polyglot-fit",
            label: "Polyglot Fit",
            dependsOn: [],
            workstreamIds: ["python-runtime", "go-status"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change services/api/app.py.",
              "Materially change internal/status/status.go.",
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
          abstentionTriggers: ["stale Go status contract"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["stale Go status contract", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "python-rust-contract-coverage",
    description:
      "The weak candidate updates only the Python runtime while the strong candidate also updates the paired Rust core artifact.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "services/session/restore.py": "def restore_session(request):\n    return None\n",
        "crates/session_core/src/lib.rs": 'pub const SESSION_RESTORE_MODE: &str = "pending";\n',
      };
    },
    taskPacket(root) {
      return {
        id: "python_rust_contract_bundle",
        title: "Revise the Python and Rust session restore bundle",
        intent:
          "Revise services/session/restore.py into the canonical session restore implementation. Very complex success also requires updating crates/session_core/src/lib.rs so the Rust core contract matches the Python runtime behavior.",
        artifactKind: "code",
        targetArtifactPath: "services/session/restore.py",
        nonGoals: [
          "Do not stop after the Python implementation if crates/session_core/src/lib.rs stays stale.",
        ],
        acceptanceCriteria: [
          "services/session/restore.py implements the session restore behavior.",
          "crates/session_core/src/lib.rs matches the cross-language core contract.",
        ],
        risks: ["A Python-only change leaves the Rust core contract stale."],
        oracleHints: [],
        strategyHints: ["Keep the Python runtime and Rust core artifacts aligned."],
        contextFiles: [
          join(root, "services", "session", "restore.py"),
          join(root, "crates", "session_core", "src", "lib.rs"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(join(root, "services", "session", "restore.py"), "utf8");
      const core = readFileSync(join(root, "crates", "session_core", "src", "lib.rs"), "utf8");
      const pythonStrong = implementation.includes("return existing_session");
      const rustStrong = core.includes('SESSION_RESTORE_MODE: &str = "existing-session"');
      return {
        score: pythonStrong && rustStrong ? 3 : pythonStrong ? 1 : 0,
        pythonStrong,
        rustStrong,
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
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex Python and Rust runtime work must keep the Python implementation and Rust core artifact in sync.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both services/session/restore.py and crates/session_core/src/lib.rs coherently.",
          "Treat Python-only changes as incomplete because the Rust core contract remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that leave crates/session_core/src/lib.rs stale.",
          "Abstain if every finalist changes the Python implementation but not the paired Rust core artifact.",
        ],
        workstreams: [
          {
            id: "python-runtime",
            label: "Python Runtime Contract",
            goal: "Update services/session/restore.py with the session restore implementation.",
            targetArtifacts: ["services/session/restore.py"],
            requiredChangedPaths: ["services/session/restore.py"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "rust-core",
            label: "Rust Core Contract",
            goal: "Update crates/session_core/src/lib.rs so the Rust core artifact matches the Python runtime behavior.",
            targetArtifacts: ["crates/session_core/src/lib.rs"],
            requiredChangedPaths: ["crates/session_core/src/lib.rs"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["python-runtime"],
            risks: ["A stale Rust core artifact leaves the cross-language contract incomplete."],
            disqualifiers: ["Do not leave crates/session_core/src/lib.rs unchanged."],
          },
        ],
        stagePlan: [
          {
            id: "python-rust-fit",
            label: "Python Rust Fit",
            dependsOn: [],
            workstreamIds: ["python-runtime", "rust-core"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change services/session/restore.py.",
              "Materially change crates/session_core/src/lib.rs.",
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
          abstentionTriggers: ["stale Rust core contract"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["stale Rust core contract", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "code-test-contract-coverage",
    description:
      "The weak candidate updates only the implementation while the strong candidate also updates the paired regression test artifact.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "packages/auth/src/session.ts":
          "export function restoreSession(request) {\n  return null;\n}\n",
        "packages/auth/test/session-refresh.test.ts":
          'import { restoreSession } from "../src/session";\n\ntest("restoreSession keeps the signed-in user across refresh", () => {\n  // TODO add the regression expectation.\n});\n',
      };
    },
    taskPacket(root) {
      return {
        id: "code_test_contract_bundle",
        title: "Revise the runtime and regression bundle for session restore",
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
        oracleHints: [],
        strategyHints: ["Keep the runtime implementation and regression test aligned."],
        contextFiles: [
          join(root, "packages", "auth", "src", "session.ts"),
          join(root, "packages", "auth", "test", "session-refresh.test.ts"),
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
        oracles: [],
      };
    },
    buildComplexPlan(plan) {
      return {
        ...plan,
        mode: "complex",
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex runtime work must keep the implementation and regression test bundle in sync.",
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
            oracleIds: [],
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
];
