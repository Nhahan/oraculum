import { describe, expect, it } from "vitest";

import {
  mockedReadRunManifest,
  registerOrcActionsTestHarness,
  runVerdictAction,
} from "./helpers/orc-actions-verdict.js";

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
});
