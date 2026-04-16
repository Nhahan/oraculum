import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCandidateScorecardPath, getFinalistScorecardsPath } from "../src/core/paths.js";
import { recommendWinnerWithJudge } from "../src/services/finalist-judge.js";
import {
  createCandidateResult,
  createConsultationPlan,
  createFinalistCandidate,
  createJudgeOnlyAdapter,
  createTaskPacket,
  createTempRoot,
  ensureReportsDir,
  registerFinalistJudgeTempRootCleanup,
} from "./helpers/finalist-judge.js";

registerFinalistJudgeTempRootCleanup();

describe("finalist judge: planning and scorecards", () => {
  it("passes planned judging preset fields to the judge for consultation-plan tasks", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_plan_judging_preset";
    const reportsDir = await ensureReportsDir(projectRoot, runId);

    let capturedPlannedJudgingPreset:
      | Parameters<Parameters<typeof createJudgeOnlyAdapter>[1]>[0]["plannedJudgingPreset"]
      | undefined;

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async (request) => {
        capturedPlannedJudgingPreset = request.plannedJudgingPreset;
        return {
          runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "judge abstained",
          recommendation: {
            decision: "abstain",
            confidence: "low",
            summary: "Need more evidence.",
          },
          artifacts: [],
        };
      }),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      consultationPlan: createConsultationPlan(projectRoot, runId, reportsDir),
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot, {
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: [],
        acceptanceCriteria: [],
        risks: [],
        oracleHints: [],
        strategyHints: [],
        contextFiles: [],
        sourceKind: "consultation-plan",
        sourcePath: join(reportsDir, "consultation-plan.json"),
      }),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(false);
    expect(outcome.judgeResult?.recommendation?.decision).toBe("abstain");
    expect(capturedPlannedJudgingPreset).toEqual({
      decisionDrivers: ["Target artifact path: docs/PRD.md"],
      plannedJudgingCriteria: [
        "Directly improves docs/PRD.md instead of only adjacent files.",
        "Leaves the planned document result internally consistent and reviewable.",
      ],
      crownGates: [
        "Do not recommend finalists that fail to materially change docs/PRD.md.",
        "Abstain if no finalist leaves the planned document result reviewable and internally consistent.",
      ],
    });
  });

  it("passes finalist scorecards to the judge and persists the finalist scorecard bundle", async () => {
    const projectRoot = await createTempRoot();
    const runId = "run_plan_scorecards";
    const reportsDir = await ensureReportsDir(projectRoot, runId);
    const candidateDir = join(projectRoot, ".oraculum", "runs", runId, "candidates", "cand-01");
    await mkdir(candidateDir, { recursive: true });

    await writeFile(
      getCandidateScorecardPath(projectRoot, runId, "cand-01"),
      `${JSON.stringify(
        {
          candidateId: "cand-01",
          mode: "complex",
          stageResults: [
            {
              stageId: "contract-fit",
              status: "pass",
              workstreamCoverage: {
                "session-contract": "covered",
              },
              violations: [],
              unresolvedRisks: [],
            },
          ],
          violations: [],
          unresolvedRisks: [],
          artifactCoherence: "strong",
          reversibility: "unknown",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    let capturedFinalists:
      | Parameters<Parameters<typeof createJudgeOnlyAdapter>[1]>[0]["finalists"]
      | undefined;

    const outcome = await recommendWinnerWithJudge({
      adapter: createJudgeOnlyAdapter("codex", async (request) => {
        capturedFinalists = request.finalists;
        return {
          runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-05T00:00:00.000Z",
          completedAt: "2026-04-05T00:00:01.000Z",
          exitCode: 0,
          summary: "judge abstained",
          recommendation: {
            decision: "abstain",
            confidence: "low",
            summary: "Need more evidence.",
          },
          artifacts: [],
        };
      }),
      candidateResults: [createCandidateResult(runId, "cand-01")],
      candidates: [createFinalistCandidate(projectRoot, "cand-01")],
      consultationPlan: {
        ...createConsultationPlan(projectRoot, runId, reportsDir),
        mode: "complex",
        plannedJudgingCriteria: [],
        crownGates: [],
        workstreams: [
          {
            id: "session-contract",
            label: "Session Contract",
            goal: "Cover the required session workstream.",
            targetArtifacts: ["docs/PRD.md"],
            requiredChangedPaths: ["docs/PRD.md"],
            protectedPaths: [],
            oracleIds: [],
            dependencies: [],
            risks: [],
            disqualifiers: [],
          },
        ],
        stagePlan: [
          {
            id: "contract-fit",
            label: "Contract Fit",
            dependsOn: [],
            workstreamIds: ["session-contract"],
            roundIds: ["fast"],
            entryCriteria: [],
            exitCriteria: [],
          },
        ],
        scorecardDefinition: {
          dimensions: ["workstream-coverage"],
          abstentionTriggers: [],
        },
      },
      projectRoot,
      runId,
      taskPacket: createTaskPacket(projectRoot, {
        artifactKind: "document",
        targetArtifactPath: "docs/PRD.md",
        nonGoals: [],
        acceptanceCriteria: [],
        risks: [],
        oracleHints: [],
        strategyHints: [],
        contextFiles: [],
        sourceKind: "consultation-plan",
        sourcePath: join(reportsDir, "consultation-plan.json"),
      }),
      verdictsByCandidate: new Map(),
    });

    expect(outcome.fallbackAllowed).toBe(false);
    expect(capturedFinalists?.[0]?.plannedScorecard).toEqual({
      mode: "complex",
      stageResults: [
        {
          stageId: "contract-fit",
          status: "pass",
          workstreamCoverage: {
            "session-contract": "covered",
          },
          violations: [],
          unresolvedRisks: [],
        },
      ],
      violations: [],
      unresolvedRisks: [],
      artifactCoherence: "strong",
      reversibility: "unknown",
    });
    await expect(
      readFile(getFinalistScorecardsPath(projectRoot, runId), "utf8"),
    ).resolves.toContain('"candidateId": "cand-01"');
    await expect(
      readFile(getFinalistScorecardsPath(projectRoot, runId), "utf8"),
    ).resolves.toContain('"strategyLabel": "Minimal Change"');
  });
});
