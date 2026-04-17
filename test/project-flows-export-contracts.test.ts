import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getLatestExportableRunStatePath } from "../src/core/paths.js";
import { exportPlanSchema } from "../src/domain/run.js";
import { buildExportPlan, planRun } from "../src/services/runs.js";
import {
  createFinalistsWithoutRecommendationProjectFlowManifest,
  createInitializedProject,
  createRecommendedProjectFlowManifest,
  registerProjectFlowsTempRootCleanup,
  writeProjectFlowFile,
  writeProjectFlowManifest,
} from "./helpers/project-flows.js";
import { writeRawRunManifest } from "./helpers/run-artifacts.js";

registerProjectFlowsTempRootCleanup();

describe("project flows export contracts", () => {
  it("rejects export plans for candidates that were not promoted", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('status is "planned"');
  });

  it("rejects implicit export when no recommended survivor exists", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended survivor");
  });

  it("rejects implicit export with artifact-aware wording when the task targets a repo artifact", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_document_without_winner";

    await writeProjectFlowManifest(
      cwd,
      createFinalistsWithoutRecommendationProjectFlowManifest(cwd, runId, {
        taskPacketOverrides: {
          artifactKind: "document",
          targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
        },
      }),
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended document result for docs/SESSION_PLAN.md");
  });

  it("preserves absolute target artifact paths outside the project root in export guidance", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_external_document_without_winner";
    const externalTargetArtifactPath = join(tmpdir(), "external", "SESSION_PLAN.md");

    await writeProjectFlowManifest(
      cwd,
      createFinalistsWithoutRecommendationProjectFlowManifest(cwd, runId, {
        taskPacketOverrides: {
          artifactKind: "document",
          targetArtifactPath: externalTargetArtifactPath,
        },
      }),
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      `does not have a recommended document result for ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
  });

  it("accepts implicit export for legacy survivor manifests that only persist outcome survivor ids", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy_survivor";

    await writeProjectFlowManifest(
      cwd,
      createRecommendedProjectFlowManifest(cwd, runId, {
        candidateStatus: "exported",
        candidateOverrides: {
          workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01"),
          taskPacketPath: join(cwd, ".oraculum", "tasks", "legacy-survivor.json"),
          workspaceMode: "copy",
          baseSnapshotPath: join(cwd, ".oraculum", "runs", runId, "cand-01-base"),
        },
        includeRecommendedWinner: false,
        taskPacketOverrides: {
          id: "task_legacy_survivor",
          title: "Legacy survivor task",
          sourcePath: join(cwd, "tasks", "legacy-survivor.md"),
        },
        outcomeOverrides: {
          judgingBasisKind: "unknown",
        },
      }),
    );

    const result = await buildExportPlan({
      cwd,
      runId,
      withReport: false,
    });

    expect(result.plan.runId).toBe(runId);
    expect(result.plan.winnerId).toBe("cand-01");
    expect(result.plan.mode).toBe("workspace-sync");
    expect(result.plan.materializationMode).toBe("workspace-sync");
  });

  it("backfills legacy export aliases from canonical materialization fields", () => {
    const plan = exportPlanSchema.parse({
      runId: "run_alias_only",
      winnerId: "cand-01",
      branchName: "fix/session-loss",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      materializationPatchPath: "/tmp/export.patch",
      withReport: false,
      createdAt: "2026-04-06T00:00:00.000Z",
    });

    expect(plan.mode).toBe("git-branch");
    expect(plan.materializationMode).toBe("branch");
    expect(plan.patchPath).toBe("/tmp/export.patch");
    expect(plan.materializationPatchPath).toBe("/tmp/export.patch");
  });

  it("rejects older exportable runs that do not record base metadata", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy";
    const createdAt = "2026-04-06T00:00:00.000Z";

    const legacyManifest = createRecommendedProjectFlowManifest(cwd, runId, {
      candidateOverrides: {
        workspaceDir: join(cwd, ".oraculum", "workspaces", runId, "cand-01"),
        workspaceMode: "git-worktree",
      },
      taskPacketOverrides: {
        id: "task_legacy",
        title: "Legacy task",
        sourcePath: join(cwd, "tasks", "legacy-task.md"),
      },
      manifestOverrides: {
        createdAt,
        rounds: [
          {
            id: "fast",
            label: "Fast",
            status: "completed",
            verdictCount: 1,
            survivorCount: 1,
            eliminatedCount: 0,
            startedAt: createdAt,
            completedAt: createdAt,
          },
          {
            id: "impact",
            label: "Impact",
            status: "completed",
            verdictCount: 1,
            survivorCount: 1,
            eliminatedCount: 0,
            startedAt: createdAt,
            completedAt: createdAt,
          },
          {
            id: "deep",
            label: "Deep",
            status: "completed",
            verdictCount: 0,
            survivorCount: 1,
            eliminatedCount: 0,
            startedAt: createdAt,
            completedAt: createdAt,
          },
        ],
      },
    });
    const { outcome, ...rawLegacyManifest } = legacyManifest;

    await writeRawRunManifest(cwd, runId, rawLegacyManifest);
    await writeFile(
      getLatestExportableRunStatePath(cwd),
      `${JSON.stringify({ runId, updatedAt: createdAt }, null, 2)}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("git base revision needed for branch materialization");
  });

  it("requires a branch name when materializing a branch-backed recommended result", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_branch_materialization";

    await writeProjectFlowManifest(
      cwd,
      createRecommendedProjectFlowManifest(cwd, runId, {
        candidateOverrides: {
          workspaceMode: "git-worktree",
          baseRevision: "abc123",
        },
        taskPacketOverrides: {
          id: "task_branch",
          title: "Branch-backed task",
          sourcePath: join(cwd, "tasks", "branch-backed.md"),
        },
      }),
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("Branch materialization requires a target branch name");
  });

  it("uses artifact-aware guidance when a recommended result lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_missing_materialization_mode";

    await writeProjectFlowManifest(
      cwd,
      createRecommendedProjectFlowManifest(cwd, runId, {
        taskPacketOverrides: {
          id: "task_document_mode",
          title: "Draft plan",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
          sourcePath: join(cwd, "tasks", "draft-plan.md"),
        },
      }),
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-01" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
  });

  it("uses selected-finalist guidance when an explicit crown target lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_selected_finalist_missing_materialization_mode";

    await writeProjectFlowManifest(
      cwd,
      createFinalistsWithoutRecommendationProjectFlowManifest(cwd, runId, {
        candidateId: "cand-02",
        taskPacketOverrides: {
          id: "task_document_selected_mode",
          title: "Draft plan",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
          sourcePath: join(cwd, "tasks", "draft-plan.md"),
        },
      }),
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        winnerId: "cand-02",
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-02" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
  });
});
