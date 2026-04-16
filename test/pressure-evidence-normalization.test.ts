import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectPressureEvidence,
  renderPressureEvidenceSummary,
} from "../src/services/pressure-evidence.js";
import {
  createClarifyPressureManifest,
  createExternalResearchPressureManifest,
  createInitializedProject,
  registerPressureEvidenceTempRootCleanup,
  writeClarifyPreflightArtifact,
  writeExternalResearchPreflightArtifact,
  writeManifest,
} from "./helpers/pressure-evidence.js";

registerPressureEvidenceTempRootCleanup();

describe("pressure evidence collection: normalization and grouping", () => {
  it("normalizes external relative and absolute task source paths when grouping repeated source pressure", async () => {
    const cwd = await createInitializedProject();
    const externalRelativeTaskSourcePath = "../shared/operator-memo.md";
    const externalAbsoluteTaskSourcePath = join(cwd, externalRelativeTaskSourcePath);

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_external_mixed_source_1", {
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Draft external operator memo",
          sourcePath: externalRelativeTaskSourcePath,
        },
        preflightOverrides: {
          summary: "The external operator memo audience is still unclear.",
          clarificationQuestion: "Who is the intended operator audience?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_external_mixed_source_1", {
      recommendation: {
        summary: "The external operator memo source is still ambiguous.",
        clarificationQuestion: "Which operator responsibilities are in scope?",
      },
    });

    await writeManifest(
      cwd,
      createExternalResearchPressureManifest("run_external_mixed_source_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Refine external operator memo",
          sourceKind: "research-brief",
          sourcePath: join(
            cwd,
            ".oraculum",
            "runs",
            "run_external_mixed_source_2",
            "reports",
            "research-brief.json",
          ),
          originKind: "task-note",
          originPath: externalAbsoluteTaskSourcePath,
        },
        preflightOverrides: {
          summary: "Official external operator guidance is still required.",
          researchQuestion: "Which operator responsibilities are in scope?",
        },
      }),
    );
    await writeExternalResearchPreflightArtifact(cwd, "run_external_mixed_source_2", {
      recommendation: {
        summary: "Official external operator guidance is still required.",
        researchQuestion: "Which operator responsibilities are in scope?",
      },
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.repeatedSources).toEqual([
      expect.objectContaining({
        taskSourcePath: externalAbsoluteTaskSourcePath,
        taskSourceKinds: ["research-brief", "task-note"],
        occurrenceCount: 2,
        latestRunId: "run_external_mixed_source_2",
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "task-source",
        key: externalAbsoluteTaskSourcePath,
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
      }),
    ]);
  });
  it("tracks repeated task sources when titles drift without a target artifact", async () => {
    const cwd = await createInitializedProject();

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_source_clarify_1", {
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Draft operator memo",
          sourcePath: "/tmp/operator-memo.md",
        },
        preflightOverrides: {
          summary: "The operator memo audience is unclear.",
          clarificationQuestion: "Who is the intended operator audience?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_source_clarify_1", {
      recommendation: {
        summary: "The operator memo audience is unclear.",
        clarificationQuestion: "Who is the intended operator audience?",
      },
    });

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_source_clarify_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Revise operator memo",
          sourcePath: "/tmp/operator-memo.md",
        },
        preflightOverrides: {
          summary: "The operator memo audience is still unclear.",
          clarificationQuestion: "Who is the intended operator audience?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_source_clarify_2", {
      recommendation: {
        summary: "The operator memo audience is still unclear.",
        clarificationQuestion: "Who is the intended operator audience?",
      },
    });

    const report = await collectPressureEvidence(cwd);
    const summary = renderPressureEvidenceSummary(report);

    expect(report.clarifyPressure.repeatedTasks).toEqual([]);
    expect(report.clarifyPressure.repeatedTargets).toEqual([]);
    expect(report.clarifyPressure.repeatedSources).toEqual([
      expect.objectContaining({
        taskSourcePath: "/tmp/operator-memo.md",
        occurrenceCount: 2,
        latestRunId: "run_source_clarify_2",
      }),
    ]);
    expect(report.clarifyPressure.promotionSignal.reasons).toEqual(
      expect.arrayContaining([
        "The same task source accumulated repeated clarify pressure across consultations.",
        "The same clarification or research blocker repeated across multiple consultations.",
      ]),
    );
    expect(summary).toContain("Repeated task sources:");
    expect(summary).toContain("/tmp/operator-memo.md: 2 cases [clarify-needed]");
  });
  it("normalizes in-repo absolute target artifact paths when grouping repeated pressure", async () => {
    const cwd = await createInitializedProject();
    const absoluteTargetArtifactPath = join(cwd, "docs", "MIXED_SCOPE.md");

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_mixed_target_1", {
        taskPacketOverrides: {
          title: "Draft mixed-scope note",
          sourcePath: "/tmp/mixed-scope-a.md",
          targetArtifactPath: "docs/MIXED_SCOPE.md",
        },
        preflightOverrides: {
          summary: "The mixed-scope note contract is unclear.",
          clarificationQuestion: "Which sections belong in the mixed-scope note?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_mixed_target_1", {
      recommendation: {
        summary: "The mixed-scope note still lacks a section contract.",
        clarificationQuestion: "Which sections must the mixed-scope note contain?",
      },
    });

    await writeManifest(
      cwd,
      createExternalResearchPressureManifest("run_mixed_target_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        taskPacketOverrides: {
          title: "Refine mixed-scope note",
          sourcePath: "/tmp/mixed-scope-b.md",
          targetArtifactPath: absoluteTargetArtifactPath,
        },
        preflightOverrides: {
          summary: "Official guidance is still required for the mixed-scope note.",
          researchQuestion: "What official guidance must the mixed-scope note cite?",
        },
      }),
    );
    await writeExternalResearchPreflightArtifact(cwd, "run_mixed_target_2", {
      recommendation: {
        summary: "Official guidance is still required for the mixed-scope note.",
        researchQuestion: "What official guidance must the mixed-scope note cite?",
      },
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.repeatedTargets).toEqual([
      expect.objectContaining({
        targetArtifactPath: "docs/MIXED_SCOPE.md",
        occurrenceCount: 2,
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "target-artifact",
        key: "docs/MIXED_SCOPE.md",
        occurrenceCount: 2,
      }),
    ]);
    expect(report.clarifyPressure.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_mixed_target_2",
          targetArtifactPath: "docs/MIXED_SCOPE.md",
        }),
      ]),
    );
  });
  it("normalizes origin-backed in-repo task source paths when grouping repeated source pressure", async () => {
    const cwd = await createInitializedProject();
    const normalizedTaskSourcePath = "tasks/operator-memo.md";
    const absoluteOriginPath = join(cwd, normalizedTaskSourcePath);

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_mixed_source_1", {
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Draft operator memo",
          sourcePath: normalizedTaskSourcePath,
        },
        preflightOverrides: {
          summary: "The operator memo audience is still unclear.",
          clarificationQuestion: "Who is the intended operator audience?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_mixed_source_1", {
      recommendation: {
        summary: "The operator memo source is still ambiguous.",
        clarificationQuestion: "Which operator responsibilities are in scope?",
      },
    });

    await writeManifest(
      cwd,
      createExternalResearchPressureManifest("run_mixed_source_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Refine operator memo",
          sourceKind: "research-brief",
          sourcePath: join(
            cwd,
            ".oraculum",
            "runs",
            "run_mixed_source_2",
            "reports",
            "research-brief.json",
          ),
          originKind: "task-note",
          originPath: absoluteOriginPath,
        },
        preflightOverrides: {
          summary: "Official operator guidance is still required.",
          researchQuestion: "Which operator responsibilities are in scope?",
        },
      }),
    );
    await writeExternalResearchPreflightArtifact(cwd, "run_mixed_source_2", {
      recommendation: {
        summary: "Official operator guidance is still required.",
        researchQuestion: "Which operator responsibilities are in scope?",
      },
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.repeatedSources).toEqual([
      expect.objectContaining({
        taskSourcePath: normalizedTaskSourcePath,
        taskSourceKinds: ["research-brief", "task-note"],
        occurrenceCount: 2,
        latestRunId: "run_mixed_source_2",
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "task-source",
        key: normalizedTaskSourcePath,
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
      }),
    ]);
    expect(report.clarifyPressure.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "run_mixed_source_2",
          taskSourcePath: normalizedTaskSourcePath,
        }),
      ]),
    );
  });
  it("normalizes dotted relative in-repo task source paths when grouping repeated source pressure", async () => {
    const cwd = await createInitializedProject();
    const normalizedTaskSourcePath = "tasks/operator-memo.md";

    await writeManifest(
      cwd,
      createClarifyPressureManifest("run_dotted_source_1", {
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Draft operator memo",
          sourcePath: normalizedTaskSourcePath,
        },
        preflightOverrides: {
          summary: "The operator memo audience is still unclear.",
          clarificationQuestion: "Who is the intended operator audience?",
        },
      }),
    );
    await writeClarifyPreflightArtifact(cwd, "run_dotted_source_1", {
      recommendation: {
        summary: "The operator memo source is still ambiguous.",
        clarificationQuestion: "Which operator responsibilities are in scope?",
      },
    });

    await writeManifest(
      cwd,
      createExternalResearchPressureManifest("run_dotted_source_2", {
        createdAt: "2026-04-05T00:00:00.000Z",
        agent: "claude-code",
        documentDefaults: false,
        taskPacketOverrides: {
          title: "Refine operator memo",
          sourcePath: `./${normalizedTaskSourcePath}`,
        },
        preflightOverrides: {
          summary: "Official operator guidance is still required.",
          researchQuestion: "Which operator responsibilities are in scope?",
        },
      }),
    );
    await writeExternalResearchPreflightArtifact(cwd, "run_dotted_source_2", {
      recommendation: {
        summary: "Official operator guidance is still required.",
        researchQuestion: "Which operator responsibilities are in scope?",
      },
    });

    const report = await collectPressureEvidence(cwd);

    expect(report.clarifyPressure.repeatedSources).toEqual([
      expect.objectContaining({
        taskSourcePath: normalizedTaskSourcePath,
        taskSourceKinds: ["task-note"],
        occurrenceCount: 2,
        latestRunId: "run_dotted_source_2",
      }),
    ]);
    expect(report.clarifyPressure.pressureTrajectories).toEqual([
      expect.objectContaining({
        keyType: "task-source",
        key: normalizedTaskSourcePath,
        occurrenceCount: 2,
        agents: ["claude-code", "codex"],
      }),
    ]);
  });
});
