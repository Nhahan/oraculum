import { describe, expect, it } from "vitest";

import {
  buildCandidatePrompt,
  buildPreflightPrompt,
  buildProfileSelectionPrompt,
  buildWinnerSelectionPrompt,
} from "../src/adapters/prompt.js";
import type {
  AgentJudgeRequest,
  AgentPreflightRequest,
  AgentProfileRequest,
  AgentRunRequest,
} from "../src/adapters/types.js";
import { classifyPlanLiftHarnessPrompt } from "../src/services/plan-lift-harness.js";
import { createMaterializedTaskPacketFixture } from "./helpers/contract-fixtures.js";

function createTaskPacket() {
  return createMaterializedTaskPacketFixture({
    id: "task",
    title: "Revise the canonical session contract bundle",
    intent:
      "Revise docs/PRD.md as the canonical session contract document and keep the result reviewable.",
    artifactKind: "document",
    targetArtifactPath: "docs/PRD.md",
    nonGoals: [],
    acceptanceCriteria: ["docs/PRD.md is materially updated."],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: ["/tmp/project/docs/PRD.md"],
    source: {
      kind: "task-packet",
      path: "/tmp/project/tasks/task.json",
    },
  });
}

function createSignals() {
  return {
    packageManager: "npm" as const,
    scripts: [],
    dependencies: [],
    files: ["package.json"],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: [],
    capabilities: [],
    provenance: [],
    commandCatalog: [],
    skippedCommandCandidates: [],
  };
}

describe("plan-lift harness prompt classification", () => {
  it("recognizes real preflight prompts", () => {
    const request: AgentPreflightRequest = {
      runId: "run_01",
      projectRoot: "/tmp/project",
      logDir: "/tmp/project/.oraculum/runs/run_01/reports",
      taskPacket: createTaskPacket(),
      signals: createSignals(),
    };

    const classification = classifyPlanLiftHarnessPrompt(buildPreflightPrompt(request));
    expect(classification).toEqual({
      isPreflight: true,
      isProfileSelection: false,
      isWinner: false,
    });
  });

  it("recognizes real profile-selection prompts", () => {
    const request: AgentProfileRequest = {
      runId: "run_01",
      projectRoot: "/tmp/project",
      logDir: "/tmp/project/.oraculum/runs/run_01/reports",
      taskPacket: createTaskPacket(),
      signals: createSignals(),
      validationPostureOptions: [
        { id: "generic", description: "Generic default posture." },
        { id: "library", description: "Library posture." },
      ],
    };

    const classification = classifyPlanLiftHarnessPrompt(buildProfileSelectionPrompt(request));
    expect(classification).toEqual({
      isPreflight: false,
      isProfileSelection: true,
      isWinner: false,
    });
  });

  it("recognizes real winner-selection prompts", () => {
    const request: AgentJudgeRequest = {
      runId: "run_01",
      projectRoot: "/tmp/project",
      logDir: "/tmp/project/.oraculum/runs/run_01/reports/judge",
      taskPacket: createTaskPacket(),
      finalists: [
        {
          candidateId: "cand-01",
          strategyLabel: "Minimal Change",
          summary: "Updated the primary artifact.",
          artifactKinds: ["report"],
          verdicts: [],
          changedPaths: ["docs/PRD.md"],
          changeSummary: {
            mode: "snapshot-diff",
            changedPathCount: 1,
            createdPathCount: 0,
            removedPathCount: 0,
            modifiedPathCount: 1,
          },
          witnessRollup: {
            witnessCount: 0,
            warningOrHigherCount: 0,
            repairableCount: 0,
            repairHints: [],
            riskSummaries: [],
            keyWitnesses: [],
          },
          repairSummary: {
            attemptCount: 0,
            repairedRounds: [],
          },
        },
      ],
    };

    const classification = classifyPlanLiftHarnessPrompt(buildWinnerSelectionPrompt(request));
    expect(classification).toEqual({
      isPreflight: false,
      isProfileSelection: false,
      isWinner: true,
    });
  });

  it("does not confuse candidate prompts with non-candidate control prompts", () => {
    const request: AgentRunRequest = {
      runId: "run_01",
      candidateId: "cand-01",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir: "/tmp/project/.oraculum/workspaces/run_01/cand-01",
      logDir: "/tmp/project/.oraculum/runs/run_01/candidates/cand-01/logs",
      taskPacket: createTaskPacket(),
    };

    const classification = classifyPlanLiftHarnessPrompt(buildCandidatePrompt(request));
    expect(classification).toEqual({
      isPreflight: false,
      isProfileSelection: false,
      isWinner: false,
    });
  });
});
