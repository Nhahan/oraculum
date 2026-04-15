import { chmodSync, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function writeNodeBinary(root, name, source) {
  await mkdir(root, { recursive: true });
  const scriptPath = join(root, `${name}.cjs`);
  await writeFile(scriptPath, source, "utf8");
  const wrapperPath = join(root, name);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const scenarios = [
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

function buildFakeCodexSource(planLiftHarness) {
  const promptMarkers = JSON.stringify(planLiftHarness.planLiftPromptMarkers);
  return [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const promptMarkers = ${promptMarkers};`,
    "const scenarioId = process.env.ORACULUM_PLAN_E2E_SCENARIO;",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "const args = process.argv.slice(2);",
    "const outIndex = args.indexOf('-o');",
    "const outPath = outIndex >= 0 ? args[outIndex + 1] || '' : '';",
    "const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);",
    "const candidateId = candidateMatch ? candidateMatch[1].trim() : 'cand-01';",
    "const isPreflight = prompt.includes(promptMarkers.preflight);",
    "const isProfileSelection = promptMarkers.profileFields.every((field) => prompt.includes(field));",
    "const isWinner = prompt.includes(promptMarkers.winner);",
    "function respond(payload) {",
    "  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);",
    "  if (outPath) fs.writeFileSync(outPath, text, 'utf8');",
    "  process.stdout.write(text + '\\\\n');",
    "}",
    "function resolveCandidateWorkspaceRoot() {",
    "  const cwd = process.cwd();",
    "  const workspaceMarker = path.sep + '.oraculum' + path.sep + 'workspaces' + path.sep;",
    "  if (cwd.includes(workspaceMarker)) return cwd;",
    "  if (!outPath) return cwd;",
    "  const segments = outPath.split(path.sep);",
    "  const dotOraculumIndex = segments.lastIndexOf('.oraculum');",
    "  const candidatesIndex = segments.lastIndexOf('candidates');",
    "  if (dotOraculumIndex < 0 || candidatesIndex < 0) return cwd;",
    "  const rootSegments = segments.slice(0, dotOraculumIndex);",
    "  const runId = segments[dotOraculumIndex + 2] || '';",
    "  const candidateIdFromPath = segments[candidatesIndex + 1] || candidateId;",
    "  const workspaceBase =",
    "    rootSegments[0] === ''",
    "      ? path.join(path.sep, ...rootSegments.slice(1))",
    "      : path.join(...rootSegments);",
    "  return path.join(workspaceBase, '.oraculum', 'workspaces', runId, candidateIdFromPath);",
    "}",
    "function write(relativePath, contents) {",
    "  const workspaceRoot = resolveCandidateWorkspaceRoot();",
    "  const absolutePath = path.join(workspaceRoot, relativePath);",
    "  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });",
    "  fs.writeFileSync(absolutePath, contents, 'utf8');",
    "}",
    "if (isPreflight) {",
    "  respond({ decision: 'proceed', confidence: 'high', summary: 'The task contract is explicit enough to proceed.', researchPosture: 'repo-only' });",
    "  process.exit(0);",
    "}",
    "if (isProfileSelection) {",
    "  respond({",
    "    validationProfileId: 'generic',",
    "    confidence: 'high',",
    "    validationSummary: 'Use the default generic validation profile for the fixture.',",
    "    candidateCount: 2,",
    "    strategyIds: ['minimal-change', 'safety-first'],",
    "    selectedCommandIds: [],",
    "    validationGaps: [],",
    "  });",
    "  process.exit(0);",
    "}",
    "if (isWinner) {",
    "  const planned = prompt.includes('Planned judging criteria:');",
    "  if (scenarioId === 'multi-artifact-contract-coverage') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 updated both contract artifacts coherently.' : 'cand-01 satisfied the primary artifact with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that update both docs/PRD.md and docs/ACCEPTANCE.md coherently.'] : ['Prioritize the primary artifact when both finalists remain reviewable.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'forbidden-collateral-boundary') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 preserved the collateral boundary while improving the PRD.' : 'cand-01 leaves the broader visible update set.', judgingCriteria: planned ? ['Prefer finalists that improve docs/PRD.md without mutating docs/CHANGELOG.md.'] : ['Prefer the finalist with the broader visible PRD-related diff.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'workstream-dependency-discipline') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 grounded the rollout in the canonical PRD before expanding rollout steps.' : 'cand-01 updates the rollout artifact with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that update docs/PRD.md before or alongside docs/ROLLOUT.md.'] : ['Prefer the finalist that most directly updates the rollout artifact.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'specificity-reviewability-bias') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 leaves a concrete, operator-reviewable specification bundle.' : 'cand-01 keeps both files aligned with the most compact visible rewrite.', judgingCriteria: planned ? ['Prefer finalists that make both docs/PRD.md and docs/ACCEPTANCE.md concrete and operator-reviewable.'] : ['Prefer the finalist that keeps both files aligned with the leanest visible rewrite.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'multi-stage-sequenced-coverage') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 closed the PRD, API, and checklist stages as one reviewable bundle.' : 'cand-01 closes the first staged contract with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that close docs/PRD.md, docs/API.md, and docs/CHECKLIST.md as one staged bundle.'] : ['Prefer the finalist that most directly updates the API contract.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'placeholder-crown-gate-bias') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 resolves the PRD and risk bundle without placeholders.' : 'cand-01 keeps both files aligned with the most compact visible rewrite.', judgingCriteria: planned ? ['Prefer finalists that resolve both docs/PRD.md and docs/RISKS.md concretely without TODO placeholders.'] : ['Prefer the finalist that keeps the written bundle compact.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'fallback-policy-stage-guard') {",
    "    process.stderr.write('winner unavailable for fallback evidence\\\\n');",
    "    process.exit(1);",
    "  }",
    "  if (scenarioId === 'code-config-contract-coverage') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 updated the Python implementation and paired runtime config coherently.' : 'cand-01 changed the implementation with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that update both src/session.py and config/session.yaml coherently.'] : ['Prioritize the implementation artifact when both finalists remain reviewable.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'code-config-reviewability-bias') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 leaves a concrete, operator-reviewable runtime bundle.' : 'cand-01 keeps the runtime bundle aligned with the most compact visible rewrite.', judgingCriteria: planned ? ['Prefer finalists that make src/session.py and config/session.yaml concrete and operator-reviewable.'] : ['Prefer the finalist that keeps the runtime bundle aligned with the leanest visible rewrite.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'polyglot-contract-coverage') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 updated the Python runtime and Go status artifacts coherently.' : 'cand-01 changed the Python runtime with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that update both services/api/app.py and internal/status/status.go coherently.'] : ['Prioritize the Python runtime artifact when both finalists remain reviewable.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'polyglot-reviewability-bias') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 leaves a concrete, operator-reviewable cross-language runtime bundle.' : 'cand-01 keeps the cross-language bundle aligned with the most compact visible rewrite.', judgingCriteria: planned ? ['Prefer finalists that make services/api/app.py and internal/status/status.go concrete and operator-reviewable.'] : ['Prefer the finalist that keeps the cross-language bundle aligned with the leanest visible rewrite.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'python-rust-contract-coverage') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 updated the Python runtime and Rust core artifacts coherently.' : 'cand-01 changed the Python runtime with the leanest visible diff.', judgingCriteria: planned ? ['Prefer finalists that update both services/session/restore.py and crates/session_core/src/lib.rs coherently.'] : ['Prioritize the Python runtime artifact when both finalists remain reviewable.'] });",
    "    process.exit(0);",
    "  }",
    "  if (scenarioId === 'rust-config-reviewability-bias') {",
    "    respond({ decision: 'select', candidateId: planned ? 'cand-02' : 'cand-01', confidence: 'high', summary: planned ? 'cand-02 leaves a concrete, operator-reviewable Rust runtime bundle.' : 'cand-01 keeps the Rust runtime bundle aligned with the most compact visible rewrite.', judgingCriteria: planned ? ['Prefer finalists that make crates/session_core/src/lib.rs and deploy/session-policy.yaml concrete and operator-reviewable.'] : ['Prefer the finalist that keeps the Rust runtime bundle aligned with the leanest visible rewrite.'] });",
    "    process.exit(0);",
    "  }",
    "}",
    "if (scenarioId === 'multi-artifact-contract-coverage') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the session.',''].join('\\\\n'));",
    "    respond('Updated only the primary PRD contract.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the session.',''].join('\\\\n'));",
    "  write('docs/ACCEPTANCE.md', ['# Acceptance','- Refresh preserves the authenticated session.','- Logging out still clears the session on the next load.',''].join('\\\\n'));",
    "  respond('Updated both planned contract artifacts.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'forbidden-collateral-boundary') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','Preserve the authenticated session across refresh.','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the session.',''].join('\\\\n'));",
    "    write('docs/CHANGELOG.md', '# Changelog\\\\n\\\\nUpdated during PRD rewrite.\\\\n');",
    "    respond('Updated the PRD but also drifted into the changelog.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','Preserve the authenticated session across a normal browser refresh so signed-in users stay signed in.','','# Constraints','- Keep the current login and logout user experience unchanged.','- Do not broaden scope beyond refresh-time session persistence.','','# Acceptance Criteria','- Refreshing the page preserves the authenticated session.','- Logging out still clears the session on the next page load.',''].join('\\\\n'));",
    "  respond('Specific PRD rewrite without collateral drift.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'workstream-dependency-discipline') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/ROLLOUT.md', ['# Rollout','- Rollout preserves the session contract during refresh.','- Verify the rollout during review.',''].join('\\\\n'));",
    "    respond('Updated only the rollout artifact.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the session contract.',''].join('\\\\n'));",
    "  write('docs/ROLLOUT.md', ['# Rollout','- Rollout preserves the session contract during a normal browser refresh.','- Roll out only after the canonical PRD is accepted.',''].join('\\\\n'));",
    "  respond('Updated the canonical PRD and the rollout artifact together.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'specificity-reviewability-bias') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','Improve session reliability.','','# Constraints','- Keep the current experience stable.','','# Acceptance Criteria','- Add checks later.',''].join('\\\\n'));",
    "    write('docs/ACCEPTANCE.md', ['# Acceptance','- Improve reliability.','- Add more checks when ready.',''].join('\\\\n'));",
    "    respond('Updated both specification artifacts with a compact generic rewrite.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','Preserve the authenticated session across a normal browser refresh so signed-in users stay signed in.','','# Constraints','- Keep the current login and logout user experience unchanged.','- Logging out must still clear the session on the next page load.','','# Acceptance Criteria','- Refreshing the page preserves the authenticated session.','- Logging out clears the session on the next page load.',''].join('\\\\n'));",
    "  write('docs/ACCEPTANCE.md', ['# Acceptance','- Refresh preserves the authenticated session.','- Logging out clears the session on the next page load.','- Reviewers can verify both checks from the written contract alone.',''].join('\\\\n'));",
    "  respond('Updated both specification artifacts with concrete reviewable language.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'multi-stage-sequenced-coverage') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the canonical contract.',''].join('\\\\n'));",
    "    write('docs/API.md', ['# API','- session restore API contract','- Return the existing session after a normal browser refresh.',''].join('\\\\n'));",
    "    respond('Closed the first staged contract but left the checklist stale.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the canonical contract.',''].join('\\\\n'));",
    "  write('docs/API.md', ['# API','- session restore API contract','- Return the existing session after a normal browser refresh.',''].join('\\\\n'));",
    "  write('docs/CHECKLIST.md', ['# Checklist','- Operators can verify the staged bundle.','- Review PRD, API, and checklist changes together before approval.',''].join('\\\\n'));",
    "  respond('Closed the full staged bundle, including the final checklist stage.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'placeholder-crown-gate-bias') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','Improve session restore behavior.','','# Constraints','- Keep the user experience stable.','','# Acceptance Criteria','- TODO decide later.',''].join('\\\\n'));",
    "    write('docs/RISKS.md', ['# Risks','- TODO choose the rollback path later.','- Review mitigation after implementation.',''].join('\\\\n'));",
    "    respond('Updated both files with a compact but unresolved placeholder bundle.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','Preserve the authenticated session across a normal browser refresh so signed-in users stay signed in.','','# Constraints','- Keep the current login and logout user experience unchanged.','- Logging out must still clear the session on the next page load.','','# Acceptance Criteria','- Refreshing the page preserves the authenticated session.','- Logging out clears the session on the next page load.',''].join('\\\\n'));",
    "  write('docs/RISKS.md', ['# Risks','- If session restore misbehaves, disable the session restore flag and fall back to the existing login flow.','- Reviewers can approve the mitigation without adding follow-up placeholders.',''].join('\\\\n'));",
    "  respond('Updated both files with a resolved, reviewable bundle.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'fallback-policy-stage-guard') {",
    "  if (candidateId === 'cand-01') {",
    "    write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the canonical contract.',''].join('\\\\n'));",
    "    write('docs/OPS.md', ['# Ops','- session restore operations contract','- Restore the existing session after a normal browser refresh.',''].join('\\\\n'));",
    "    respond('Closed the first staged operations contract only.');",
    "    process.exit(0);",
    "  }",
    "  write('docs/PRD.md', ['# Goal','canonical session contract','','# Constraints','- Keep logout behavior unchanged.','','# Acceptance Criteria','- Refresh preserves the canonical contract.',''].join('\\\\n'));",
    "  write('docs/OPS.md', ['# Ops','- session restore operations contract','- Restore the existing session after a normal browser refresh.',''].join('\\\\n'));",
    "  write('docs/VERIFY.md', ['# Verify','- Operators can verify the fallback-safe staged bundle.','- Review PRD, ops, and verification notes together before approval.',''].join('\\\\n'));",
    "  respond('Closed the staged operations bundle so fallback can safely select the survivor.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'code-config-contract-coverage') {",
    "  if (candidateId === 'cand-01') {",
    "    write('src/session.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "    respond('Updated only the Python implementation artifact.');",
    "    process.exit(0);",
    "  }",
    "  write('src/session.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "  write('config/session.yaml', ['restore_on_refresh: true','logout_clears_on_next_load: true',''].join('\\\\n'));",
    "  respond('Updated the Python implementation and paired runtime config.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'code-config-reviewability-bias') {",
    "  if (candidateId === 'cand-01') {",
    "    write('src/session.py', ['def restore_session(request):','    # Improve reliability later.','    return request.session',''].join('\\\\n'));",
    "    write('config/session.yaml', ['restore_on_refresh: later','logout_clears_on_next_load: review-later',''].join('\\\\n'));",
    "    respond('Updated the code and config bundle with a compact generic rewrite.');",
    "    process.exit(0);",
    "  }",
    "  write('src/session.py', ['def restore_session(request):','    \"\"\"Preserve the authenticated session across a normal browser refresh.\"\"\"','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "  write('config/session.yaml', ['restore_on_refresh: true','logout_clears_on_next_load: true',''].join('\\\\n'));",
    "  respond('Updated the code and config bundle with concrete runtime markers.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'polyglot-contract-coverage') {",
    "  if (candidateId === 'cand-01') {",
    "    write('services/api/app.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "    respond('Updated only the Python runtime artifact.');",
    "    process.exit(0);",
    "  }",
    "  write('services/api/app.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "  write('internal/status/status.go', ['package status','','const SessionRestoreStatus = \"SessionRestored\"',''].join('\\\\n'));",
    "  respond('Updated the Python runtime and paired Go status artifact.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'polyglot-reviewability-bias') {",
    "  if (candidateId === 'cand-01') {",
    "    write('services/api/app.py', ['def restore_session(request):','    # Improve cross-language behavior steadily.','    return request.session',''].join('\\\\n'));",
    "    write('internal/status/status.go', ['package status','','const SessionRestoreStatus = \"SessionReady\"',''].join('\\\\n'));",
    "    respond('Updated the Python and Go bundle with a compact generic rewrite.');",
    "    process.exit(0);",
    "  }",
    "  write('services/api/app.py', ['def restore_session(request):','    \"\"\"Preserve the authenticated session across a normal browser refresh.\"\"\"','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "  write('internal/status/status.go', ['package status','','const SessionRestoreStatus = \"SessionRestored\"','const LogoutStatus = \"LogoutClearsOnNextLoad\"',''].join('\\\\n'));",
    "  respond('Updated the Python and Go bundle with concrete cross-language runtime markers.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'python-rust-contract-coverage') {",
    "  if (candidateId === 'cand-01') {",
    "    write('services/session/restore.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "    respond('Updated only the Python runtime artifact.');",
    "    process.exit(0);",
    "  }",
    "  write('services/session/restore.py', ['def restore_session(request):','    existing_session = request.session','    if existing_session is None:','        return None','    return existing_session',''].join('\\\\n'));",
    "  write('crates/session_core/src/lib.rs', ['pub const SESSION_RESTORE_MODE: &str = \"existing-session\";',''].join('\\\\n'));",
    "  respond('Updated the Python runtime and paired Rust core artifact.');",
    "  process.exit(0);",
    "}",
    "if (scenarioId === 'rust-config-reviewability-bias') {",
    "  if (candidateId === 'cand-01') {",
    "    write('crates/session_core/src/lib.rs', ['pub const SESSION_RESTORE_MODE: &str = \"steady-improvement\";',''].join('\\\\n'));",
    "    write('deploy/session-policy.yaml', ['restore_mode: later','logout_policy: review-later',''].join('\\\\n'));",
    "    respond('Updated the Rust and YAML bundle with a compact generic rewrite.');",
    "    process.exit(0);",
    "  }",
    "  write('crates/session_core/src/lib.rs', ['pub const SESSION_RESTORE_MODE: &str = \"existing-session\";','pub const LOGOUT_POLICY: &str = \"clears-on-next-load\";',''].join('\\\\n'));",
    "  write('deploy/session-policy.yaml', ['restore_mode: existing-session','logout_policy: clears-on-next-load',''].join('\\\\n'));",
    "  respond('Updated the Rust and YAML bundle with concrete runtime markers.');",
    "  process.exit(0);",
    "}",
    "respond('No-op');",
  ].join("\n");
}

async function writeFixture(root, scenario) {
  await mkdir(join(root, ".oraculum"), { recursive: true });
  await mkdir(join(root, "tasks"), { recursive: true });
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

async function runRoute(root, scenario, mode, fakeCodex, mcpTools, runDomain) {
  const restoreEnv = patchEnv({
    ORACULUM_CODEX_BIN: fakeCodex,
    ORACULUM_PLAN_E2E_SCENARIO: scenario.id,
  });
  try {
    const taskPath = join(root, "tasks", "task.json");
    if (mode === "direct") {
      const consult = await mcpTools.runConsultTool({
        cwd: root,
        taskInput: taskPath,
        agent: "codex",
        candidates: 2,
        timeoutMs: 10_000,
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
        crownVerified,
        ...(crownError ? { crownError } : {}),
        judgingCriteria: await readWinnerCriteria(consult.artifacts),
        quality: scenario.analyze(root),
      };
    }

    const plan = await mcpTools.runPlanTool({
      cwd: root,
      taskInput: taskPath,
      agent: "codex",
      candidates: 2,
      timeoutMs: 10_000,
    });
    await promoteScenarioPlanIfNeeded(scenario, plan.artifacts.consultationPlanPath, runDomain);
    const consult = await mcpTools.runConsultTool({
      cwd: root,
      taskInput: plan.artifacts.consultationPlanPath,
      agent: "codex",
      candidates: 2,
      timeoutMs: 10_000,
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
      crownVerified,
      ...(crownError ? { crownError } : {}),
      judgingCriteria: await readWinnerCriteria(consult.artifacts),
      quality: scenario.analyze(root),
    };
  } finally {
    restoreEnv();
  }
}

export async function runPlanLiftEvidence({ mcpTools, planLiftHarness, runDomain }) {
  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-plan-lift-"));
  const fakeCodex = await writeNodeBinary(
    tempRoot,
    "fake-codex",
    buildFakeCodexSource(planLiftHarness),
  );
  const results = [];

  try {
    for (const scenario of scenarios) {
      const baseRoot = join(tempRoot, scenario.id, "base");
      const directRoot = join(tempRoot, scenario.id, "direct");
      const plannedRoot = join(tempRoot, scenario.id, "planned");
      await writeFixture(baseRoot, scenario);
      await cp(baseRoot, directRoot, { recursive: true });
      await cp(baseRoot, plannedRoot, { recursive: true });

      const direct = await runRoute(directRoot, scenario, "direct", fakeCodex, mcpTools, runDomain);
      const planned = await runRoute(
        plannedRoot,
        scenario,
        "planned",
        fakeCodex,
        mcpTools,
        runDomain,
      );
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
