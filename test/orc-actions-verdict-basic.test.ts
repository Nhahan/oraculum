import { describe, expect, it } from "vitest";

import {
  createBlockedPreflightManifest,
  createCandidate,
  createCompletedManifest,
  mockedReadRunManifest,
  registerOrcActionsTestHarness,
  runVerdictAction,
} from "./helpers/orc-actions-verdict.js";
import { createBlockedPreflightOutcomeFixture } from "./helpers/run-manifest.js";

registerOrcActionsTestHarness();

describe("chat-native Orc actions: verdict basics", () => {
  it("rejects unknown verdict request fields", async () => {
    await expect(
      runVerdictAction({
        cwd: "/tmp/project",
        consultationId: "run_1",
        includeDebug: true,
      } as Parameters<typeof runVerdictAction>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedReadRunManifest).not.toHaveBeenCalled();
  });

  it("rejects unsafe consultation ids before reading artifacts", async () => {
    await expect(
      runVerdictAction({
        cwd: "/tmp/project",
        consultationId: "../run",
      }),
    ).rejects.toThrow("Artifact ids must be safe single path segments.");

    expect(mockedReadRunManifest).not.toHaveBeenCalled();
  });

  it("reopens verdicts through Orc actions", async () => {
    const verdict = await runVerdictAction({
      cwd: "/tmp/project",
      consultationId: "run_9",
    });

    expect(mockedReadRunManifest).toHaveBeenCalledWith("/tmp/project", "run_9");
    expect(verdict.mode).toBe("verdict");
    expect(verdict.status).toMatchObject({
      consultationId: "run_1",
      outcomeType: "recommended-survivor",
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      validationProfileId: "library",
      validationSummary: "Package export evidence is strongest.",
      validationSignals: ["package-export"],
      validationGaps: [],
      researchRerunRecommended: false,
      nextActions: ["reopen-verdict", "crown-recommended-result"],
    });
    expect(verdict.review).toMatchObject({
      outcomeType: "recommended-survivor",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      validationProfileId: "library",
      validationSignals: ["package-export"],
    });
  });
  it("surfaces apply approval when reopening an eligible crownable verdict", async () => {
    mockedReadRunManifest.mockResolvedValueOnce({
      ...createCompletedManifest(),
      candidates: [
        createCandidate("cand-01", {
          status: "promoted",
          workspaceMode: "copy",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
        }),
      ],
    });

    const verdict = await runVerdictAction({
      cwd: "/tmp/project",
      consultationId: "run_1",
    });

    expect(verdict.userInteraction).toMatchObject({
      kind: "apply-approval",
      runId: "run_1",
      header: "Apply recommended result",
    });
  });
  it("surfaces answerable blocked consultation clarification through verdict", async () => {
    mockedReadRunManifest.mockResolvedValueOnce(createBlockedPreflightManifest());

    const verdict = await runVerdictAction({
      cwd: "/tmp/project",
      consultationId: "run_blocked",
    });

    expect(verdict.userInteraction).toEqual({
      kind: "consult-clarification",
      runId: "run_blocked",
      header: "Consult clarification",
      question: "Which file should Oraculum update?",
      expectedAnswerShape:
        "Answer with the missing implementation scope, target artifact, acceptance signal, or constraint needed before candidate execution.",
      freeTextAllowed: true,
    });
  });
  it("does not surface user interaction for external research blockers", async () => {
    mockedReadRunManifest.mockResolvedValueOnce({
      ...createBlockedPreflightManifest(),
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Official docs are required before execution.",
        researchPosture: "external-research-required",
        researchQuestion: "What do the official docs say?",
      },
      outcome: createBlockedPreflightOutcomeFixture({
        type: "external-research-required",
        validationPosture: "validation-gaps",
        validationGapCount: 1,
      }),
    });

    const verdict = await runVerdictAction({
      cwd: "/tmp/project",
      consultationId: "run_research",
    });

    expect(verdict.userInteraction).toBeUndefined();
  });
});
