import { readFileSync } from "node:fs";
import { join } from "node:path";

export const extendedScenarios = [
  {
    id: "multi-artifact-contract-coverage",
    description:
      "The weak candidate only updates the primary artifact while the strong candidate also updates the second required contract artifact.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/ACCEPTANCE.md": "# Acceptance\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "session_contract_bundle",
        title: "Revise the canonical session contract bundle",
        intent:
          "Revise docs/PRD.md as the canonical session contract document. Very complex success also requires updating docs/ACCEPTANCE.md with the concrete rollout checks.",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: ["Do not stop after editing only the primary PRD artifact."],
        acceptanceCriteria: [
          "docs/PRD.md states the canonical session contract.",
          "The contract stays concrete enough for operator review.",
        ],
        risks: [],
        oracleHints: [],
        strategyHints: [],
        contextFiles: [join(root, "docs", "PRD.md"), join(root, "docs", "ACCEPTANCE.md")],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const acceptance = readFileSync(join(root, "docs", "ACCEPTANCE.md"), "utf8");
      const prdStrong = prd.includes("canonical session contract");
      const acceptanceStrong = acceptance.includes("Refresh preserves the authenticated session.");
      return {
        score: prdStrong && acceptanceStrong ? 3 : prdStrong ? 1 : 0,
        prdStrong,
        acceptanceStrong,
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
          "Complex contract: the PRD and acceptance checklist must move together.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update both docs/PRD.md and docs/ACCEPTANCE.md coherently.",
          "Reject finalists that only touch the primary artifact while leaving the acceptance contract stale.",
        ],
        crownGates: [
          "Do not recommend finalists that fail to materially update docs/ACCEPTANCE.md.",
          "Abstain if the PRD and acceptance checklist drift apart.",
        ],
        workstreams: [
          {
            id: "primary-contract",
            label: "Primary Session Contract",
            goal: "Update the canonical session contract in docs/PRD.md.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "acceptance-contract",
            label: "Acceptance Checklist Contract",
            goal: "Update docs/ACCEPTANCE.md with the concrete rollout checks.",
            targetArtifacts: ["docs/ACCEPTANCE.md"],
            requiredChangedPaths: ["docs/ACCEPTANCE.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["primary-contract"],
            risks: [],
            disqualifiers: ["Do not leave docs/ACCEPTANCE.md stale."],
          },
        ],
        stagePlan: [
          {
            id: "contract-fit",
            label: "Contract Fit",
            dependsOn: [],
            workstreamIds: ["primary-contract", "acceptance-contract"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change docs/PRD.md.",
              "Materially change docs/ACCEPTANCE.md.",
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
          abstentionTriggers: [
            "missing acceptance-contract coverage",
            "stale acceptance checklist",
          ],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "forbidden-collateral-boundary",
    description:
      "The weak candidate changes the primary artifact but also mutates a forbidden collateral file that direct consult does not guard.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/CHANGELOG.md": "# Changelog\n\nDo not modify this file for the PRD task.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "prd_boundary_contract",
        title: "Revise the canonical PRD without collateral policy drift",
        intent:
          "Rewrite docs/PRD.md into a coherent, reviewable session-restore PRD. Very complex success must avoid collateral edits to docs/CHANGELOG.md.",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: ["Do not mutate docs/CHANGELOG.md while revising the PRD."],
        acceptanceCriteria: ["docs/PRD.md is rewritten into a reviewable session-restore PRD."],
        risks: ["Collateral policy drift in docs/CHANGELOG.md is not acceptable."],
        oracleHints: [],
        strategyHints: ["Keep collateral scope tight."],
        contextFiles: [join(root, "docs", "PRD.md"), join(root, "docs", "CHANGELOG.md")],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const changelog = readFileSync(join(root, "docs", "CHANGELOG.md"), "utf8");
      const prdStrong = prd.includes("Preserve the authenticated session");
      const changelogUntouched = changelog.includes("Do not modify this file");
      return {
        score: prdStrong && changelogUntouched ? 3 : prdStrong ? 1 : 0,
        prdStrong,
        changelogUntouched,
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
          "Complex boundary: changelog policy must remain untouched during PRD work.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that improve docs/PRD.md without mutating docs/CHANGELOG.md.",
          "Treat collateral changelog edits as disqualifying policy drift.",
        ],
        crownGates: [
          "Do not recommend finalists that touch docs/CHANGELOG.md.",
          "Abstain if every finalist drifts into collateral policy edits.",
        ],
        workstreams: [
          {
            id: "primary-prd",
            label: "Primary PRD Contract",
            goal: "Rewrite docs/PRD.md into the session-restore PRD.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: ["docs/CHANGELOG.md"],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: ["Do not mutate docs/CHANGELOG.md."],
          },
        ],
        stagePlan: [
          {
            id: "contract-fit",
            label: "Contract Fit",
            dependsOn: [],
            workstreamIds: ["primary-prd"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: ["Materially change docs/PRD.md.", "Leave docs/CHANGELOG.md untouched."],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "protected-path-discipline",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["protected path violation"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: ["protected-path-violation", "forbidden-collateral-path"],
          repairable: [],
          preferAbstainOverRetry: ["weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "workstream-dependency-discipline",
    description:
      "The weak candidate updates only the dependent rollout artifact while the strong candidate grounds the rollout in the prerequisite canonical contract.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/ROLLOUT.md": "# Rollout\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "rollout_dependency_bundle",
        title: "Revise the session rollout bundle",
        intent:
          "Revise docs/ROLLOUT.md into the rollout bundle for session persistence. Very complex success also requires grounding the rollout in docs/PRD.md first so the rollout stays attached to the canonical contract.",
        artifactKind: "document",
        targetArtifactPath: "docs/ROLLOUT.md",
        nonGoals: ["Do not rewrite the rollout document without also grounding the canonical PRD."],
        acceptanceCriteria: [
          "docs/ROLLOUT.md is materially updated.",
          "The rollout stays grounded in the canonical contract.",
        ],
        risks: ["A rollout without a grounded PRD leaves integration review unsafe."],
        oracleHints: [],
        strategyHints: ["Preserve the dependency between the canonical contract and the rollout."],
        contextFiles: [join(root, "docs", "PRD.md"), join(root, "docs", "ROLLOUT.md")],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const rollout = readFileSync(join(root, "docs", "ROLLOUT.md"), "utf8");
      const prdStrong = prd.includes("canonical session contract");
      const rolloutStrong = rollout.includes("Rollout preserves the session contract");
      return {
        score: prdStrong && rolloutStrong ? 3 : rolloutStrong ? 1 : 0,
        prdStrong,
        rolloutStrong,
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
          "Complex rollout work must stay grounded in the canonical PRD before rollout details are accepted.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that update docs/PRD.md before or alongside docs/ROLLOUT.md.",
          "Treat rollout-only edits as incomplete because the canonical contract remains stale.",
        ],
        crownGates: [
          "Do not recommend finalists that edit docs/ROLLOUT.md without also updating docs/PRD.md.",
          "Abstain if every finalist leaves the rollout disconnected from the canonical PRD.",
        ],
        workstreams: [
          {
            id: "canonical-contract",
            label: "Canonical Session Contract",
            goal: "Update docs/PRD.md so the rollout remains grounded in the canonical contract.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: ["A stale canonical contract makes rollout review unsafe."],
            disqualifiers: [],
          },
          {
            id: "rollout-contract",
            label: "Rollout Contract",
            goal: "Update docs/ROLLOUT.md with rollout steps that stay grounded in the canonical PRD.",
            targetArtifacts: ["docs/ROLLOUT.md"],
            requiredChangedPaths: ["docs/ROLLOUT.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["canonical-contract"],
            risks: ["Rollout details without a grounded PRD create an integration contradiction."],
            disqualifiers: ["Do not update the rollout without first grounding the PRD."],
          },
        ],
        stagePlan: [
          {
            id: "integration-fit",
            label: "Integration Fit",
            dependsOn: [],
            workstreamIds: ["canonical-contract", "rollout-contract"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: ["Materially change docs/PRD.md.", "Materially change docs/ROLLOUT.md."],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "dependency-discipline",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["rollout dependency contradiction"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["integration-contradiction", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "specificity-reviewability-bias",
    description:
      "Both candidates satisfy the file-level contract, but only the strong candidate leaves a concrete, operator-reviewable specification bundle.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/ACCEPTANCE.md": "# Acceptance\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "specificity_bundle",
        title: "Revise the session specification bundle",
        intent:
          "Revise docs/PRD.md and docs/ACCEPTANCE.md into a coherent session specification bundle. Very complex success prefers concrete, operator-reviewable contract language over generic placeholders.",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: ["Do not stop at generic language like improve reliability or add checks later."],
        acceptanceCriteria: [
          "docs/PRD.md is materially updated.",
          "docs/ACCEPTANCE.md is materially updated.",
        ],
        risks: ["Generic wording makes operator review ambiguous even when both files change."],
        oracleHints: [],
        strategyHints: ["Prefer concrete, reviewable contract language."],
        contextFiles: [join(root, "docs", "PRD.md"), join(root, "docs", "ACCEPTANCE.md")],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const acceptance = readFileSync(join(root, "docs", "ACCEPTANCE.md"), "utf8");
      const prdSpecific = prd.includes("normal browser refresh") && prd.includes("next page load");
      const acceptanceSpecific =
        acceptance.includes("Refresh preserves the authenticated session.") &&
        acceptance.includes("Logging out clears the session on the next page load.");
      return {
        score: prdSpecific && acceptanceSpecific ? 3 : 1,
        prdSpecific,
        acceptanceSpecific,
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
        requiredChangedPaths: ["docs/PRD.md", "docs/ACCEPTANCE.md"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex specification work should prefer concrete, operator-reviewable contract language over generic edits.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make both docs/PRD.md and docs/ACCEPTANCE.md concrete and operator-reviewable.",
          "Treat generic phrases like improve reliability or add checks later as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the specification bundle generic or placeholder-like.",
          "Abstain if every finalist changes the files but keeps the contract too vague for operator review.",
        ],
        workstreams: [
          {
            id: "primary-spec",
            label: "Primary Specification",
            goal: "Update docs/PRD.md with a concrete session specification.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "acceptance-spec",
            label: "Acceptance Specification",
            goal: "Update docs/ACCEPTANCE.md with concrete reviewable checks.",
            targetArtifacts: ["docs/ACCEPTANCE.md"],
            requiredChangedPaths: ["docs/ACCEPTANCE.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["primary-spec"],
            risks: ["Generic acceptance text keeps the specification bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "specification-fit",
            label: "Specification Fit",
            dependsOn: [],
            workstreamIds: ["primary-spec", "acceptance-spec"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change docs/PRD.md.",
              "Materially change docs/ACCEPTANCE.md.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic specification bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "multi-stage-sequenced-coverage",
    description:
      "The weak candidate completes the first contract stage but omits the final checklist stage, while the strong candidate closes the full staged bundle.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/API.md": "# API\n\nPlaceholder.\n",
        "docs/CHECKLIST.md": "# Checklist\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "staged_contract_bundle",
        title: "Revise the staged session contract bundle",
        intent:
          "Revise docs/API.md into the session restore API contract. Very complex success also requires grounding the API in docs/PRD.md and finishing docs/CHECKLIST.md so operators can verify the staged bundle end to end.",
        artifactKind: "document",
        targetArtifactPath: "docs/API.md",
        nonGoals: ["Do not stop after the API contract if the final checklist remains stale."],
        acceptanceCriteria: [
          "docs/API.md is materially updated.",
          "The staged bundle ends with an operator checklist.",
        ],
        risks: ["A partial staged bundle leaves the review flow incomplete."],
        oracleHints: [],
        strategyHints: ["Close the full staged bundle, not only the first contract stage."],
        contextFiles: [
          join(root, "docs", "PRD.md"),
          join(root, "docs", "API.md"),
          join(root, "docs", "CHECKLIST.md"),
        ],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const api = readFileSync(join(root, "docs", "API.md"), "utf8");
      const checklist = readFileSync(join(root, "docs", "CHECKLIST.md"), "utf8");
      const prdStrong = prd.includes("canonical session contract");
      const apiStrong = api.includes("session restore API contract");
      const checklistStrong = checklist.includes("Operators can verify the staged bundle.");
      return {
        score: prdStrong && apiStrong && checklistStrong ? 3 : prdStrong && apiStrong ? 1 : 0,
        prdStrong,
        apiStrong,
        checklistStrong,
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
          "Complex staged work is incomplete until the final checklist stage closes the bundle.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that close docs/PRD.md, docs/API.md, and docs/CHECKLIST.md as one staged bundle.",
          "Treat finalists that stop before the checklist stage as incomplete even if the API contract looks strong.",
        ],
        crownGates: [
          "Do not recommend finalists that leave docs/CHECKLIST.md stale.",
          "Abstain if every finalist stops before the final checklist stage.",
        ],
        workstreams: [
          {
            id: "canonical-prd",
            label: "Canonical PRD",
            goal: "Update docs/PRD.md so the staged bundle remains grounded in the canonical contract.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "api-contract",
            label: "API Contract",
            goal: "Update docs/API.md with the session restore API contract.",
            targetArtifacts: ["docs/API.md"],
            requiredChangedPaths: ["docs/API.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["canonical-prd"],
            risks: ["An API contract without the canonical PRD remains weak."],
            disqualifiers: [],
          },
          {
            id: "operator-checklist",
            label: "Operator Checklist",
            goal: "Finish docs/CHECKLIST.md so operators can verify the staged bundle end to end.",
            targetArtifacts: ["docs/CHECKLIST.md"],
            requiredChangedPaths: ["docs/CHECKLIST.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["api-contract"],
            risks: ["A missing checklist leaves the staged bundle incomplete for review."],
            disqualifiers: ["Do not stop before the checklist stage."],
          },
        ],
        stagePlan: [
          {
            id: "contract-fit",
            label: "Contract Fit",
            dependsOn: [],
            workstreamIds: ["canonical-prd", "api-contract"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: ["Materially change docs/PRD.md.", "Materially change docs/API.md."],
          },
          {
            id: "review-readiness",
            label: "Review Readiness",
            dependsOn: ["contract-fit"],
            workstreamIds: ["operator-checklist"],
            roundIds: ["impact"],
            entryCriteria: ["The staged contract fit already passed."],
            exitCriteria: ["Materially change docs/CHECKLIST.md."],
          },
        ],
        scorecardDefinition: {
          dimensions: [
            "workstream-coverage",
            "stage-completion",
            "artifact-coherence",
            "oracle-pass-summary",
          ],
          abstentionTriggers: ["missing final checklist stage"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["missing final checklist stage", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "placeholder-crown-gate-bias",
    description:
      "Both candidates satisfy the file-level contract, but only the strong candidate resolves the bundle without TODO placeholders or deferred decisions.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "docs/PRD.md": "# PRD\n\nPlaceholder.\n",
        "docs/RISKS.md": "# Risks\n\nPlaceholder.\n",
      };
    },
    taskPacket(root) {
      return {
        id: "resolved_bundle",
        title: "Revise the resolved session bundle",
        intent:
          "Revise docs/PRD.md and docs/RISKS.md into a coherent session restore bundle. Very complex success requires resolved, operator-reviewable language instead of TODO placeholders or deferred decisions.",
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: ["Do not leave TODO or decide-later placeholders in the final artifact bundle."],
        acceptanceCriteria: [
          "docs/PRD.md is materially updated.",
          "docs/RISKS.md is materially updated.",
        ],
        risks: ["Deferred placeholders make the final bundle hard to approve."],
        oracleHints: [],
        strategyHints: ["Prefer resolved language over TODO placeholders."],
        contextFiles: [join(root, "docs", "PRD.md"), join(root, "docs", "RISKS.md")],
      };
    },
    analyze(root) {
      const prd = readFileSync(join(root, "docs", "PRD.md"), "utf8");
      const risks = readFileSync(join(root, "docs", "RISKS.md"), "utf8");
      const prdConcrete = prd.includes("normal browser refresh") && prd.includes("next page load");
      const risksConcrete = risks.includes("disable the session restore flag");
      const hasTodo =
        prd.includes("TODO") || prd.includes("decide later") || risks.includes("TODO");
      return {
        score: prdConcrete && risksConcrete && !hasTodo ? 3 : 1,
        prdConcrete,
        risksConcrete,
        hasTodo,
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
        requiredChangedPaths: ["docs/PRD.md", "docs/RISKS.md"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex review bundles should reject TODO placeholders and deferred risk decisions.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that resolve both docs/PRD.md and docs/RISKS.md concretely without TODO placeholders.",
          "Treat deferred decisions or TODO notes as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave TODO placeholders or decide-later text in docs/PRD.md or docs/RISKS.md.",
          "Abstain if every finalist leaves unresolved placeholders in the final bundle.",
        ],
        workstreams: [
          {
            id: "primary-resolution",
            label: "Primary Resolution",
            goal: "Update docs/PRD.md with a resolved, reviewable session contract.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "risk-resolution",
            label: "Risk Resolution",
            goal: "Update docs/RISKS.md with concrete mitigation and rollback language.",
            targetArtifacts: ["docs/RISKS.md"],
            requiredChangedPaths: ["docs/RISKS.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["primary-resolution"],
            risks: ["TODO placeholders keep the risk bundle unresolved."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "resolved-bundle",
            label: "Resolved Bundle",
            dependsOn: [],
            workstreamIds: ["primary-resolution", "risk-resolution"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: ["Materially change docs/PRD.md.", "Materially change docs/RISKS.md."],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["unresolved placeholder bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["unresolved placeholder bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "code-config-reviewability-bias",
    description:
      "Both candidates satisfy the file-level code and config contract, but only the strong candidate leaves a concrete, operator-reviewable runtime bundle.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "src/session.py": "def restore_session(request):\n    return None\n",
        "config/session.yaml": "restore_on_refresh: false\nlogout_clears_on_next_load: false\n",
      };
    },
    taskPacket(root) {
      return {
        id: "code_config_reviewability",
        title: "Revise the reviewable runtime bundle",
        intent:
          "Revise src/session.py and config/session.yaml into a coherent runtime bundle. Very complex success prefers concrete, operator-reviewable implementation and config language over generic placeholders.",
        artifactKind: "code",
        targetArtifactPath: "src/session.py",
        nonGoals: ["Do not leave the runtime bundle at generic TODO-style language."],
        acceptanceCriteria: [
          "src/session.py is materially updated.",
          "config/session.yaml is materially updated.",
        ],
        risks: [
          "Generic code/config wording makes runtime review ambiguous even when both files changed.",
        ],
        oracleHints: [],
        strategyHints: ["Prefer concrete runtime behavior and config markers."],
        contextFiles: [join(root, "src", "session.py"), join(root, "config", "session.yaml")],
      };
    },
    analyze(root) {
      const implementation = readFileSync(join(root, "src", "session.py"), "utf8");
      const config = readFileSync(join(root, "config", "session.yaml"), "utf8");
      const codeSpecific =
        implementation.includes("normal browser refresh") &&
        implementation.includes("return existing_session");
      const configSpecific =
        config.includes("restore_on_refresh: true") &&
        config.includes("logout_clears_on_next_load: true");
      return {
        score: codeSpecific && configSpecific ? 3 : 1,
        codeSpecific,
        configSpecific,
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
        requiredChangedPaths: ["src/session.py", "config/session.yaml"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex runtime work should prefer concrete, reviewable implementation and config bundles over generic rewrites.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make src/session.py and config/session.yaml concrete and operator-reviewable.",
          "Treat generic runtime wording like improve reliability later as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the runtime bundle generic or placeholder-like.",
          "Abstain if every finalist changes both files but keeps the runtime behavior too vague for review.",
        ],
        workstreams: [
          {
            id: "python-runtime",
            label: "Python Runtime Contract",
            goal: "Update src/session.py with a concrete session restore implementation.",
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
            goal: "Update config/session.yaml with concrete runtime flags that match the implementation.",
            targetArtifacts: ["config/session.yaml"],
            requiredChangedPaths: ["config/session.yaml"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["python-runtime"],
            risks: ["Generic config text keeps the runtime bundle weak."],
            disqualifiers: [],
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
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic runtime bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic runtime bundle", "weak-finalist-evidence"],
        },
      };
    },
  },

  {
    id: "polyglot-reviewability-bias",
    description:
      "Both candidates satisfy the Python and Go file contract, but only the strong candidate leaves a concrete, operator-reviewable cross-language bundle.",
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
        id: "polyglot_reviewability",
        title: "Revise the reviewable polyglot runtime bundle",
        intent:
          "Revise services/api/app.py and internal/status/status.go into a coherent cross-language runtime bundle. Very complex success prefers concrete, operator-reviewable semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "services/api/app.py",
        nonGoals: ["Do not leave the cross-language runtime bundle at generic wording."],
        acceptanceCriteria: [
          "services/api/app.py is materially updated.",
          "internal/status/status.go is materially updated.",
        ],
        risks: [
          "Generic cross-language wording makes the runtime behavior weakly reviewable even when both files changed.",
        ],
        oracleHints: [],
        strategyHints: ["Prefer concrete Python and Go runtime semantics."],
        contextFiles: [
          join(root, "services", "api", "app.py"),
          join(root, "internal", "status", "status.go"),
        ],
      };
    },
    analyze(root) {
      const implementation = readFileSync(join(root, "services", "api", "app.py"), "utf8");
      const status = readFileSync(join(root, "internal", "status", "status.go"), "utf8");
      const pythonSpecific =
        implementation.includes("normal browser refresh") &&
        implementation.includes("return existing_session");
      const goSpecific =
        status.includes("SessionRestored") && status.includes("LogoutClearsOnNextLoad");
      return {
        score: pythonSpecific && goSpecific ? 3 : 1,
        pythonSpecific,
        goSpecific,
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
        requiredChangedPaths: ["services/api/app.py", "internal/status/status.go"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex polyglot runtime work should prefer concrete, reviewable Python and Go bundles over generic rewrites.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make services/api/app.py and internal/status/status.go concrete and operator-reviewable.",
          "Treat generic cross-language wording as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the cross-language runtime bundle generic.",
          "Abstain if every finalist changes both files but keeps the runtime semantics too vague for review.",
        ],
        workstreams: [
          {
            id: "python-runtime",
            label: "Python Runtime Contract",
            goal: "Update services/api/app.py with a concrete session restore implementation.",
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
            goal: "Update internal/status/status.go with concrete status markers that match the Python runtime.",
            targetArtifacts: ["internal/status/status.go"],
            requiredChangedPaths: ["internal/status/status.go"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["python-runtime"],
            risks: ["Generic Go status wording keeps the cross-language bundle weak."],
            disqualifiers: [],
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
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic cross-language runtime bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: [
            "generic cross-language runtime bundle",
            "weak-finalist-evidence",
          ],
        },
      };
    },
  },

  {
    id: "rust-config-reviewability-bias",
    description:
      "Both candidates satisfy the Rust and YAML file contract, but only the strong candidate leaves a concrete, operator-reviewable runtime bundle.",
    weakCandidateId: "cand-01",
    initialFiles() {
      return {
        "crates/session_core/src/lib.rs": 'pub const SESSION_RESTORE_MODE: &str = "pending";\n',
        "deploy/session-policy.yaml": "restore_mode: pending\nlogout_policy: review-later\n",
      };
    },
    taskPacket(root) {
      return {
        id: "rust_config_reviewability",
        title: "Revise the reviewable Rust runtime bundle",
        intent:
          "Revise crates/session_core/src/lib.rs and deploy/session-policy.yaml into a coherent runtime bundle. Very complex success prefers concrete, operator-reviewable Rust and YAML semantics over generic rewrites.",
        artifactKind: "code",
        targetArtifactPath: "crates/session_core/src/lib.rs",
        nonGoals: ["Do not leave the Rust runtime bundle at generic wording."],
        acceptanceCriteria: [
          "crates/session_core/src/lib.rs is materially updated.",
          "deploy/session-policy.yaml is materially updated.",
        ],
        risks: [
          "Generic Rust and YAML wording makes the runtime bundle weakly reviewable even when both files changed.",
        ],
        oracleHints: [],
        strategyHints: ["Prefer concrete Rust behavior and YAML policy markers."],
        contextFiles: [
          join(root, "crates", "session_core", "src", "lib.rs"),
          join(root, "deploy", "session-policy.yaml"),
        ],
      };
    },
    analyze(root) {
      const core = readFileSync(join(root, "crates", "session_core", "src", "lib.rs"), "utf8");
      const policy = readFileSync(join(root, "deploy", "session-policy.yaml"), "utf8");
      const rustSpecific =
        core.includes('SESSION_RESTORE_MODE: &str = "existing-session"') &&
        core.includes('LOGOUT_POLICY: &str = "clears-on-next-load"');
      const configSpecific =
        policy.includes("restore_mode: existing-session") &&
        policy.includes("logout_policy: clears-on-next-load");
      return {
        score: rustSpecific && configSpecific ? 3 : 1,
        rustSpecific,
        configSpecific,
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
        requiredChangedPaths: ["crates/session_core/src/lib.rs", "deploy/session-policy.yaml"],
        decisionDrivers: [
          ...plan.decisionDrivers,
          "Complex Rust runtime work should prefer concrete, reviewable Rust and YAML bundles over generic rewrites.",
        ],
        plannedJudgingCriteria: [
          "Prefer finalists that make crates/session_core/src/lib.rs and deploy/session-policy.yaml concrete and operator-reviewable.",
          "Treat generic Rust or YAML wording as materially weaker even when both files changed.",
        ],
        crownGates: [
          "Do not recommend finalists that leave the Rust runtime bundle generic.",
          "Abstain if every finalist changes both files but keeps the runtime semantics too vague for review.",
        ],
        workstreams: [
          {
            id: "rust-core",
            label: "Rust Core Contract",
            goal: "Update crates/session_core/src/lib.rs with a concrete session restore implementation.",
            targetArtifacts: ["crates/session_core/src/lib.rs"],
            requiredChangedPaths: ["crates/session_core/src/lib.rs"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
          {
            id: "runtime-policy",
            label: "Runtime Policy Contract",
            goal: "Update deploy/session-policy.yaml with concrete runtime policy markers that match the Rust core artifact.",
            targetArtifacts: ["deploy/session-policy.yaml"],
            requiredChangedPaths: ["deploy/session-policy.yaml"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: ["rust-core"],
            risks: ["Generic YAML policy wording keeps the runtime bundle weak."],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "rust-config-fit",
            label: "Rust Config Fit",
            dependsOn: [],
            workstreamIds: ["rust-core", "runtime-policy"],
            roundIds: ["impact"],
            entryCriteria: ["Consultation plan basis remains current."],
            exitCriteria: [
              "Materially change crates/session_core/src/lib.rs.",
              "Materially change deploy/session-policy.yaml.",
            ],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage", "artifact-coherence", "oracle-pass-summary"],
          abstentionTriggers: ["generic Rust runtime bundle"],
        },
        repairPolicy: {
          maxAttemptsPerStage: 0,
          immediateElimination: [],
          repairable: ["missing-target-coverage", "partial-workstream-coverage"],
          preferAbstainOverRetry: ["generic Rust runtime bundle", "weak-finalist-evidence"],
        },
      };
    },
  },
];
