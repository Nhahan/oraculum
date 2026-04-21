import { describe, expect, it } from "vitest";

import {
  collectPressureEvidence,
  renderPressureEvidenceSummary,
} from "../src/services/pressure-evidence.js";
import {
  createClarifyPressureManifest,
  createInitializedProject,
  registerPressureEvidenceTempRootCleanup,
  writeClarifyFollowUp,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./helpers/pressure-evidence.js";

registerPressureEvidenceTempRootCleanup();

describe("pressure evidence collection: clarify pressure", () => {
  it("collects recurring clarify pressure from saved consultations", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_1", {
        taskPacketOverrides: {
          title: "Draft session plan",
          sourcePath: "/tmp/task.md",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_clarify_1", {
      llmFailure: "runtime unavailable",
      recommendation: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections are required in the session plan?",
      },
    });
    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_2", {
        createdAt: "2026-04-06T00:00:00.000Z",
        agent: "claude-code",
        taskPacketOverrides: {
          title: "Finalize session plan",
          sourcePath: "/tmp/task-v2.md",
        },
        preflightOverrides: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official release guidance is required before execution.",
          researchPosture: "external-research-required",
          researchQuestion:
            "What do the official docs require for the current release plan format?",
        },
        outcomeOverrides: {
          type: "external-research-required",
          validationPosture: "validation-gaps",
          judgingBasisKind: "missing-capability",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_clarify_2", {
      llmSkipped: true,
      recommendation: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official release guidance is required before execution.",
        researchPosture: "external-research-required",
        researchQuestion: "What do the official docs require for the current release plan format?",
      },
    });
    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_3", {
        createdAt: "2026-04-07T00:00:00.000Z",
        taskPacketOverrides: {
          title: "Review session plan",
          sourcePath: "/tmp/task-v3.md",
        },
        preflightOverrides: {
          summary: "The target sections are still unclear.",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_clarify_3", {
      llmFailure: "host timeout",
      recommendation: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target sections are still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which sections are required in the session plan?",
      },
    });
    await writeClarifyFollowUp(cwd, "run_clarify_3", {
      runId: "run_clarify_3",
      adapter: "codex",
      decision: "needs-clarification",
      scopeKeyType: "target-artifact",
      scopeKey: "docs/SESSION_PLAN.md",
      repeatedCaseCount: 3,
      repeatedKinds: ["clarify-needed", "external-research-required"],
      recurringReasons: ["Which sections are required in the session plan?"],
      summary: "The repeated blocker is still the missing document contract.",
      keyQuestion: "Which sections are required in the session plan?",
      missingResultContract:
        "The session plan still lacks a concrete section contract for the target document.",
      missingJudgingBasis:
        "Winner selection is still unsafe until the required sections are explicit.",
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.consultationCount).toBe(3);
    expect(report.artifactCoverage).toEqual(
      expect.objectContaining({
        consultationsWithPreflightReadiness: 3,
        consultationsWithPreflightFallback: 3,
        consultationsWithClarifyFollowUp: 1,
        consultationsWithManualReviewRecommendation: 3,
      }),
    );
    expect(report.clarifyPressure.artifactCoverage).toEqual(
      expect.objectContaining({
        caseCount: 3,
        casesWithTargetArtifact: 3,
        casesWithPreflightReadiness: 3,
        casesWithPreflightFallback: 3,
        casesWithClarifyFollowUp: 1,
        casesWithResearchBrief: 0,
        casesWithManualReviewRecommendation: 3,
      }),
    );
    expect(report.clarifyPressure.agentBreakdown).toEqual([
      expect.objectContaining({
        agent: "codex",
        caseCount: 2,
        consultationCount: 2,
      }),
      expect.objectContaining({
        agent: "claude-code",
        caseCount: 1,
        consultationCount: 1,
      }),
    ]);
    expect(report.clarifyPressure.totalCases).toBe(3);
    expect(report.clarifyPressure.needsClarificationCases).toBe(2);
    expect(report.clarifyPressure.externalResearchRequiredCases).toBe(1);
    expect(report.clarifyPressure.repeatedTasks).toEqual([]);
    expect(report.clarifyPressure.repeatedSources).toEqual([]);
    expect(report.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath: "docs/SESSION_PLAN.md",
        occurrenceCount: 3,
        latestRunId: "run_clarify_3",
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/SESSION_PLAN.md",
        occurrenceCount: 3,
        agents: ["claude-code", "codex"],
        distinctKinds: expect.arrayContaining(["clarify-needed", "external-research-required"]),
      }),
    ]);
    expect(report.clarifyPressure.recurringReasons).toEqual([
      expect.objectContaining({
        label: "Which sections are required in the session plan?",
        occurrenceCount: 2,
      }),
    ]);
    expect(report.clarifyPressure.coverageBlindSpots).toEqual([
      "Clarify evidence is dominated by fallback preflight results instead of structured runtime recommendations.",
      "External-research blockers have no persisted research-brief artifacts yet.",
    ]);
    expect(report.clarifyPressure.coverageGapRuns).toEqual([
      expect.objectContaining({
        runId: "run_clarify_2",
        missingArtifactKinds: ["research-brief"],
        manifestPath: ".oraculum/runs/run_clarify_2/run.json",
      }),
    ]);
    expect(report.clarifyPressure.missingArtifactBreakdown).toEqual([
      {
        artifactKind: "research-brief",
        consultationCount: 1,
      },
    ]);
    expect(report.clarifyPressure.inspectionQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "clarify-follow-up",
          runId: "run_clarify_3",
          path: ".oraculum/runs/run_clarify_3/reports/clarify-follow-up.json",
        }),
        expect.objectContaining({
          artifactKind: "run-manifest",
          runId: "run_clarify_2",
          path: ".oraculum/runs/run_clarify_2/run.json",
        }),
        expect.objectContaining({
          artifactKind: "preflight-readiness",
          runId: "run_clarify_3",
        }),
        expect.objectContaining({
          artifactKind: "preflight-readiness",
          runId: "run_clarify_2",
        }),
      ]),
    );
    expect(report.clarifyPressure.promotionSignal).toEqual(
      expect.objectContaining({
        shouldPromote: true,
        distinctRunCount: 3,
      }),
    );
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "3 consultations ended in clarify pressure.",
        "The same target artifact accumulated repeated clarify pressure across consultations.",
        "The same clarify scope moved across multiple pressure kinds.",
        "The same clarify pressure trajectory crossed multiple hosts.",
        "The same clarification or research blocker repeated across multiple consultations.",
      ]),
    );
    expect(report.clarifyPressure.cases[0]).toEqual(
      expect.objectContaining({
        kind: "clarify-needed",
        agent: "codex",
        question: "Which sections are required in the session plan?",
        artifactPaths: expect.objectContaining({
          clarifyFollowUpPath: expect.stringContaining(
            ".oraculum/runs/run_clarify_3/reports/clarify-follow-up.json",
          ),
          preflightReadinessPath: expect.stringContaining(
            ".oraculum/runs/run_clarify_3/reports/preflight-readiness.json",
          ),
        }),
      }),
    );
    const clarifySummary = renderPressureEvidenceSummary(report);
    expect(clarifySummary).toContain(
      "Artifact coverage: preflight-readiness=3 preflight-fallback=3 clarify-follow-up=1 comparison=0 winner-selection=0 failure-analysis=0 research-brief=0 manual-review=3",
    );
    expect(clarifySummary).toContain(
      "Clarify evidence coverage: targets=3 preflight-readiness=3 preflight-fallback=3 clarify-follow-up=1 research-brief=0 manual-review=3",
    );
    expect(clarifySummary).toContain("Missing clarify artifacts: research-brief=1");
  });
  it("tracks clarify metadata from stale research and unresolved conflicts", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_research_clarify", {
        taskPacketOverrides: {
          title: "Audit vendor rollout guidance",
          sourcePath: "/tmp/vendor-rollout.md",
          targetArtifactPath: "docs/VENDOR_ROLLOUT.md",
          researchContext: {
            question: "Which rollout guidance is current?",
            summary: "The official guidance diverges across two recent documents.",
            confidence: "medium",
            signalSummary: ["official rollout guidance conflict"],
            sources: [
              {
                kind: "official-doc",
                title: "Rollout guide v1",
                locator: "https://example.test/rollout-v1",
              },
              {
                kind: "official-doc",
                title: "Rollout guide v2",
                locator: "https://example.test/rollout-v2",
              },
            ],
            claims: [
              {
                statement: "The rollout cutoff changed in the latest guidance.",
                sourceLocators: ["https://example.test/rollout-v2"],
              },
            ],
            versionNotes: ["v1 and v2 disagree on the cutoff date."],
            unresolvedConflicts: ["The official docs disagree on the rollout cutoff date."],
            conflictHandling: "manual-review-required",
          },
        },
        preflightOverrides: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official rollout guidance still conflicts and needs bounded research.",
          researchPosture: "external-research-required",
          researchQuestion: "Which rollout cutoff date is current in the official guidance?",
          researchBasisDrift: true,
        },
        outcomeOverrides: {
          type: "external-research-required",
          validationPosture: "validation-gaps",
          judgingBasisKind: "missing-capability",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_research_clarify", {
      recommendation: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official rollout guidance still conflicts and needs bounded research.",
        researchPosture: "external-research-required",
        researchQuestion: "Which rollout cutoff date is current in the official guidance?",
        researchBasisDrift: true,
      },
    });

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.clarifyPressure.metadataCoverage).toEqual(
      expect.objectContaining({
        consultationCount: 1,
        consultationsWithValidationGaps: 1,
        consultationsWithCurrentResearchBasis: 0,
        consultationsWithStaleResearchBasis: 1,
        consultationsWithUnknownResearchBasis: 0,
        consultationsWithResearchConflicts: 1,
        consultationsWithResearchRerunRecommended: 1,
        consultationsWithJudgingCriteria: 0,
      }),
    );
    expect(report.clarifyPressure.cases).toEqual([
      expect.objectContaining({
        runId: "run_research_clarify",
        researchBasisStatus: "stale",
        researchConflictHandling: "manual-review-required",
        researchRerunRecommended: true,
        validationPosture: "validation-gaps",
      }),
    ]);
    expect(summary).toContain(
      "Clarify metadata: validation-gaps=1 research-current=0 research-stale=1 research-unknown=0 research-conflicts=1 rerun=1",
    );
  });
  it("reports missing clarify follow-up only on the latest repeated scope without persisted guidance", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_gap_1", {
        taskPacketOverrides: {
          title: "Draft release checklist",
          sourcePath: "/tmp/release-checklist.md",
          targetArtifactPath: "docs/RELEASE_CHECKLIST.md",
        },
        preflightOverrides: {
          summary: "The release checklist sections are unclear.",
          clarificationQuestion: "Which checklist sections are required?",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_clarify_gap_1", {
      llmFailure: "host timeout",
      recommendation: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The release checklist sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which checklist sections are required?",
      },
    });

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_gap_2", {
        createdAt: "2026-04-06T00:00:00.000Z",
        taskPacketOverrides: {
          title: "Finalize release checklist",
          sourcePath: "/tmp/release-checklist-v2.md",
          targetArtifactPath: "docs/RELEASE_CHECKLIST.md",
        },
        preflightOverrides: {
          summary: "The release checklist sections are still unclear.",
          clarificationQuestion: "Which checklist sections are required?",
        },
      }),
    );
    await writePreflightReadinessArtifact(cwd, "run_clarify_gap_2", {
      llmFailure: "host timeout",
      recommendation: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The release checklist sections are still unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which checklist sections are required?",
      },
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.coverageBlindSpots).not.toContain(
      "Repeated clarify pressure is missing persisted clarify-follow-up artifacts.",
    );
    expect(report.clarifyPressure.coverageGapRuns).toEqual([]);
    expect(report.clarifyPressure.missingArtifactBreakdown).toEqual([]);
  });
  it("keeps expecting clarify follow-up artifacts on later repeated runs after the first persisted follow-up", async () => {
    const cwd = await createInitializedProject();

    for (const [runId, createdAt] of [
      ["run_clarify_followup_1", "2026-04-14T00:00:00.000Z"],
      ["run_clarify_followup_2", "2026-04-14T00:01:00.000Z"],
      ["run_clarify_followup_3", "2026-04-14T00:02:00.000Z"],
      ["run_clarify_followup_4", "2026-04-14T00:03:00.000Z"],
    ] as const) {
      await writeManifest(
        cwd,
        createClarifyPressureManifest(runId, {
          createdAt,
          taskPacketOverrides: {
            title: "Clarify rollout checklist",
            sourcePath: "/tmp/rollout-checklist.md",
            targetArtifactPath: "docs/ROLLOUT_CHECKLIST.md",
          },
          preflightOverrides: {
            summary: "The rollout checklist details are still unclear.",
            clarificationQuestion: "Which rollout checklist sections are required?",
          },
        }),
      );
      await writePreflightReadinessArtifact(cwd, runId, {
        recommendation: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The rollout checklist details are still unclear.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which rollout checklist sections are required?",
        },
      });
    }

    await writeClarifyFollowUp(cwd, "run_clarify_followup_3", {
      runId: "run_clarify_followup_3",
      adapter: "codex",
      decision: "needs-clarification",
      scopeKeyType: "target-artifact",
      scopeKey: "docs/ROLLOUT_CHECKLIST.md",
      repeatedCaseCount: 3,
      repeatedKinds: ["clarify-needed"],
      recurringReasons: ["Which rollout checklist sections are required?"],
      summary: "The same clarify blocker repeated across rollout checklist runs.",
      keyQuestion: "Which rollout checklist sections are required?",
      missingResultContract: "The rollout checklist still lacks a concrete result contract.",
      missingJudgingBasis: "The judging basis for the checklist is still implicit.",
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.coverageBlindSpots).toContain(
      "Repeated clarify pressure is missing persisted clarify-follow-up artifacts.",
    );
    expect(report.clarifyPressure.coverageGapRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_clarify_followup_4",
          missingArtifactKinds: ["clarify-follow-up"],
        }),
      ]),
    );
    expect(report.clarifyPressure.coverageGapRuns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_clarify_followup_3",
          missingArtifactKinds: ["clarify-follow-up"],
        }),
      ]),
    );
    expect(report.clarifyPressure.missingArtifactBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: "clarify-follow-up",
          consultationCount: 1,
        }),
      ]),
    );
  });
  it("orders repeated clarify follow-up expectations by run sequence instead of completion timestamp", async () => {
    const cwd = await createInitializedProject();
    const runIds = [
      "run_20260415010101_aaaabbbb",
      "run_20260415010102_bbbbcccc",
      "run_20260415010103_ccccdddd",
    ] as const;
    const createdAts = [
      "2026-04-15T00:00:03.000Z",
      "2026-04-15T00:00:02.000Z",
      "2026-04-15T00:00:01.000Z",
    ] as const;

    for (const [index, runId] of runIds.entries()) {
      await writeManifest(
        cwd,
        createClarifyPressureManifest(runId, {
          createdAt: createdAts[index] ?? "2026-04-15T00:00:00.000Z",
          taskPacketOverrides: {
            title: "Clarify rollout sequencing",
            sourcePath: "/tmp/rollout-sequencing.md",
            targetArtifactPath: "docs/ROLLOUT_SEQUENCE.md",
          },
          preflightOverrides: {
            summary: "The rollout sequence is still ambiguous.",
            clarificationQuestion: "Which rollout phases are mandatory before release?",
          },
        }),
      );
      await writePreflightReadinessArtifact(cwd, runId, {
        recommendation: {
          decision: "needs-clarification",
          confidence: "medium",
          summary: "The rollout sequence is still ambiguous.",
          researchPosture: "repo-only",
          clarificationQuestion: "Which rollout phases are mandatory before release?",
        },
      });
    }

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.coverageGapRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_20260415010103_ccccdddd",
          missingArtifactKinds: ["clarify-follow-up"],
        }),
      ]),
    );
    expect(report.clarifyPressure.coverageGapRuns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_20260415010101_aaaabbbb",
          missingArtifactKinds: ["clarify-follow-up"],
        }),
      ]),
    );
  });
  it("does not promote clarify pressure from unrelated multi-host cases alone", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_unrelated_clarify_codex", {
        taskPacketOverrides: {
          title: "Draft rollout note",
          sourcePath: "/tmp/rollout-note.md",
          targetArtifactPath: "docs/ROLLOUT.md",
        },
        preflightOverrides: {
          summary: "The rollout audience is unclear.",
          clarificationQuestion: "Who is the rollout audience?",
        },
      }),
    );

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_unrelated_clarify_claude", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        taskPacketOverrides: {
          title: "Draft launch checklist",
          sourcePath: "/tmp/launch-checklist.md",
          targetArtifactPath: "docs/LAUNCH.md",
        },
        preflightOverrides: {
          summary: "The launch milestones are unclear.",
          clarificationQuestion: "Which launch milestones matter most?",
        },
      }),
    );

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.agentBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "codex", caseCount: 1 }),
        expect.objectContaining({ agent: "claude-code", caseCount: 1 }),
      ]),
    );
    expect(report.clarifyPressure.pressureTrajectories).toEqual([]);
    expect(report.clarifyPressure.promotionSignal).toEqual(
      expect.objectContaining({
        shouldPromote: false,
        distinctRunCount: 2,
      }),
    );
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual([]);
  });
  it("tracks same-kind cross-host clarify trajectories on the same scope", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_same_kind_1", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "codex",
        taskPacketOverrides: {
          title: "Draft weekly evidence note",
          sourcePath: "/tmp/weekly-status-a.md",
          targetArtifactPath: "docs/WEEKLY_STATUS.md",
        },
        preflightOverrides: {
          confidence: "high",
          summary: "The audience and required sections are unclear.",
          clarificationQuestion: "Which audience and required sections should this note target?",
        },
      }),
    );

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_clarify_same_kind_2", {
        createdAt: "2026-04-06T00:00:00.000Z",
        agent: "claude-code",
        taskPacketOverrides: {
          title: "Fill weekly evidence note",
          sourcePath: "/tmp/weekly-status-b.md",
          targetArtifactPath: "docs/WEEKLY_STATUS.md",
        },
        preflightOverrides: {
          summary: "The same document contract is still unresolved.",
          clarificationQuestion: "Which audience and required sections should this note target?",
        },
      }),
    );

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/WEEKLY_STATUS.md",
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
        distinctKinds: ["clarify-needed"],
      }),
    ]);
  });
});
