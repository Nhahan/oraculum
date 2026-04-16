import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { consultationPlanArtifactSchema } from "../src/domain/run.js";
import { loadTaskPacket, readConsultationPlanArtifact } from "../src/services/task-packets.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-task-packets-");
tempRootHarness.registerCleanup();

describe("task packet loading", () => {
  it("materializes consultation plans as rerunnable task packets", async () => {
    const root = await createTempRoot();
    const originalTaskPath = join(root, "tasks", "fix-session.md");
    const planPath = join(
      root,
      ".oraculum",
      "runs",
      "run_plan",
      "reports",
      "consultation-plan.json",
    );

    await mkdir(join(root, "tasks"), { recursive: true });
    await mkdir(join(root, ".oraculum", "runs", "run_plan", "reports"), { recursive: true });

    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_plan",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_plan/reports/consultation-plan.json`.",
          intendedResult: "recommended result for src/session.ts",
          decisionDrivers: ["Target artifact path: src/session.ts"],
          openQuestions: ["Should the refresh token rotation stay backward compatible?"],
          task: {
            id: "fix-session",
            title: "Fix session loss",
            intent: "Keep the user session across page refreshes.",
            artifactKind: "code patch",
            targetArtifactPath: "src/session.ts",
            nonGoals: [],
            acceptanceCriteria: ["Refreshing the page keeps the user logged in."],
            risks: ["Do not break logout."],
            oracleHints: ["Run auth-focused checks."],
            strategyHints: [],
            contextFiles: ["src/session.ts"],
            source: {
              kind: "task-note",
              path: originalTaskPath,
            },
          },
          preflight: {
            decision: "proceed",
            confidence: "medium",
            summary: "Proceed conservatively.",
            researchPosture: "repo-only",
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
            },
            {
              id: "safety-first",
              label: "Safety First",
            },
          ],
          oracleIds: ["lint-fast", "auth-integration"],
          requiredChangedPaths: ["src/session.ts", "src/session.test.ts"],
          protectedPaths: ["docs/KEEP.md"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
            {
              id: "impact",
              label: "Impact",
            },
          ],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const taskPacket = await loadTaskPacket(planPath);

    expect(taskPacket.source.kind).toBe("consultation-plan");
    expect(taskPacket.source.path).toBe(planPath);
    expect(taskPacket.source.originKind).toBe("task-note");
    expect(taskPacket.source.originPath).toBe(originalTaskPath);
    expect(taskPacket.intent).toContain("Consultation plan context:");
    expect(taskPacket.intent).toContain("Planned strategies:");
    expect(taskPacket.intent).toContain("Required changed paths:");
    expect(taskPacket.intent).toContain("Protected paths:");
    expect(taskPacket.intent).toContain("Recommended next action:");
    expect(taskPacket.intent).not.toContain("Planned workstreams:");
    expect(taskPacket.intent).not.toContain("Planned stage order:");
    expect(taskPacket.strategyHints).toContain("Planned strategy: Minimal Change (minimal-change)");
    expect(taskPacket.oracleHints).toContain("Planned oracle: lint-fast");
    expect(taskPacket.acceptanceCriteria).toContain("Must change src/session.ts.");
    expect(taskPacket.nonGoals).toContain("Do not modify docs/KEEP.md.");
    expect(taskPacket.contextFiles).toContain(originalTaskPath);
  });

  it("materializes complex consultation plan graphs into the task intent", async () => {
    const root = await createTempRoot();
    const originalTaskPath = join(root, "tasks", "complex-session.md");
    const planPath = join(
      root,
      ".oraculum",
      "runs",
      "run_complex_plan",
      "reports",
      "consultation-plan.json",
    );

    await mkdir(join(root, "tasks"), { recursive: true });
    await mkdir(join(root, ".oraculum", "runs", "run_complex_plan", "reports"), {
      recursive: true,
    });

    await writeFile(
      planPath,
      `${JSON.stringify(
        consultationPlanArtifactSchema.parse({
          runId: "run_complex_plan",
          createdAt: "2026-04-15T00:00:00.000Z",
          mode: "complex",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_complex_plan/reports/consultation-plan.json`.",
          intendedResult: "recommended result for src/session.ts",
          decisionDrivers: ["Target artifact path: src/session.ts"],
          openQuestions: [],
          repoBasis: {
            projectRoot: root,
            signalFingerprint: "sha256:complex",
            availableOracleIds: ["auth-impact"],
          },
          task: {
            id: "complex-session",
            title: "Complex session task",
            intent: "Preserve the authenticated session while keeping logout semantics intact.",
            artifactKind: "code patch",
            targetArtifactPath: "src/session.ts",
            nonGoals: [],
            acceptanceCriteria: ["Refreshing the page keeps the session alive."],
            risks: ["Do not break logout."],
            oracleHints: [],
            strategyHints: [],
            contextFiles: [originalTaskPath],
            source: {
              kind: "task-note",
              path: originalTaskPath,
            },
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "bridge-migration",
              label: "Bridge Migration",
            },
          ],
          oracleIds: ["auth-impact"],
          requiredChangedPaths: ["src/session.ts"],
          protectedPaths: ["src/logout.ts"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
            {
              id: "impact",
              label: "Impact",
            },
          ],
          workstreams: [
            {
              id: "session-contract",
              label: "Session Contract",
              goal: "Keep authenticated users signed in across normal refresh.",
              targetArtifacts: ["src/session.ts"],
              requiredChangedPaths: ["src/session.ts"],
              protectedPaths: ["src/logout.ts"],
              oracleIds: ["auth-impact"],
              dependencies: [],
              risks: ["Do not regress logout."],
              disqualifiers: ["Only docs change."],
            },
          ],
          stagePlan: [
            {
              id: "contract-fit",
              label: "Contract Fit",
              dependsOn: [],
              workstreamIds: ["session-contract"],
              roundIds: ["fast", "impact"],
              entryCriteria: ["consultation plan basis remains current"],
              exitCriteria: ["all required paths are changed"],
            },
          ],
          scorecardDefinition: {
            dimensions: ["workstream-coverage", "artifact-coherence"],
            abstentionTriggers: ["missing required workstream coverage"],
          },
          repairPolicy: {
            maxAttemptsPerStage: 1,
            immediateElimination: ["protected-path-violation"],
            repairable: ["missing-target-coverage"],
            preferAbstainOverRetry: ["integration-contradiction"],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const taskPacket = await loadTaskPacket(planPath);

    expect(taskPacket.intent).toContain("Plan mode: complex");
    expect(taskPacket.intent).toContain("Planned workstreams:");
    expect(taskPacket.intent).toContain(
      "Session Contract (session-contract): Keep authenticated users signed in across normal refresh.",
    );
    expect(taskPacket.intent).toContain("protected paths: src/logout.ts");
    expect(taskPacket.intent).toContain("Planned stage order:");
    expect(taskPacket.intent).toContain("Contract Fit (contract-fit)");
    expect(taskPacket.intent).toContain("rounds: fast, impact");
    expect(taskPacket.intent).toContain("Planned scorecard:");
    expect(taskPacket.intent).toContain("dimension: workstream-coverage");
    expect(taskPacket.intent).toContain("Planned repair policy:");
    expect(taskPacket.intent).toContain("immediate elimination: protected-path-violation");
    expect(taskPacket.acceptanceCriteria).toContain("Must change src/session.ts.");
    expect(taskPacket.nonGoals).toContain("Do not modify src/logout.ts.");
  });

  it("parses legacy consultation plans without execution-graph metadata", async () => {
    const root = await createTempRoot();
    const originalTaskPath = join(root, "tasks", "legacy-session.md");
    const planPath = join(
      root,
      ".oraculum",
      "runs",
      "run_legacy_plan",
      "reports",
      "consultation-plan.json",
    );

    await mkdir(join(root, "tasks"), { recursive: true });
    await mkdir(join(root, ".oraculum", "runs", "run_legacy_plan", "reports"), {
      recursive: true,
    });
    await writeFile(
      planPath,
      `${JSON.stringify(
        {
          runId: "run_legacy_plan",
          createdAt: "2026-04-15T00:00:00.000Z",
          readyForConsult: true,
          recommendedNextAction:
            "Execute the planned consultation: `orc consult .oraculum/runs/run_legacy_plan/reports/consultation-plan.json`.",
          intendedResult: "recommended result for src/session.ts",
          decisionDrivers: ["Target artifact path: src/session.ts"],
          openQuestions: [],
          task: {
            id: "legacy-session",
            title: "Legacy session task",
            intent: "Preserve the session across refreshes.",
            artifactKind: "code patch",
            targetArtifactPath: "src/session.ts",
            nonGoals: [],
            acceptanceCriteria: ["Refreshing the page keeps the session alive."],
            risks: [],
            oracleHints: [],
            strategyHints: [],
            contextFiles: [originalTaskPath],
            source: {
              kind: "task-note",
              path: originalTaskPath,
            },
          },
          candidateCount: 2,
          plannedStrategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
            },
          ],
          oracleIds: ["lint-fast"],
          roundOrder: [
            {
              id: "fast",
              label: "Fast",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const artifact = await readConsultationPlanArtifact(planPath);

    expect(artifact).toBeDefined();
    expect(artifact?.mode).toBe("standard");
    expect(artifact?.repoBasis).toMatchObject({
      projectRoot: "<unknown>",
      signalFingerprint: "unknown",
      availableOracleIds: [],
    });
    expect(artifact?.workstreams).toEqual([]);
    expect(artifact?.stagePlan).toEqual([]);
    expect(artifact?.scorecardDefinition).toEqual({
      dimensions: [],
      abstentionTriggers: [],
    });
    expect(artifact?.repairPolicy).toEqual({
      maxAttemptsPerStage: 0,
      immediateElimination: [],
      repairable: [],
      preferAbstainOverRetry: [],
    });
  });
});

async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
