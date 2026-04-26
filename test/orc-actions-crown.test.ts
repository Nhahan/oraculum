import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

vi.mock("../src/services/runs.js", () => ({
  answerPlanRun: vi.fn(),
  planRun: vi.fn(),
  readLatestRunManifest: vi.fn(),
  readRunManifest: vi.fn(),
  writeLatestRunState: vi.fn(),
}));

vi.mock("../src/services/execution.js", () => ({
  executeRun: vi.fn(),
}));

vi.mock("../src/services/project.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/project.js")>(
    "../src/services/project.js",
  );

  return {
    ...actual,
    ensureProjectInitialized: vi.fn(),
    hasNonEmptyTextArtifact: vi.fn(() => false),
    hasNonEmptyTextArtifactSync: vi.fn(() => false),
    initializeProject: vi.fn(),
  };
});

vi.mock("../src/services/consultations.js", () => ({
  buildVerdictReview: vi.fn(),
  renderConsultationSummary: vi.fn(),
}));

vi.mock("../src/services/exports.js", () => ({
  materializeExport: vi.fn(),
}));

import { runCrownAction } from "../src/services/orc-actions.js";
import {
  createOrcActionTempRoot,
  createSubprocessResult,
  mockedMaterializeExport,
  mockedReadRunManifest,
  mockedRunSubprocess,
  registerOrcActionsTestHarness,
  writeExportPatch,
} from "./helpers/orc-actions.js";

registerOrcActionsTestHarness();

describe("chat-native Orc actions: crown", () => {
  it("rejects unknown public crown request fields before materialization", async () => {
    await expect(
      runCrownAction({
        cwd: "/tmp/project",
        withReport: false,
        unsafe: true,
      } as Parameters<typeof runCrownAction>[0]),
    ).rejects.toThrow(/Unrecognized key/);
    expect(mockedMaterializeExport).not.toHaveBeenCalled();
  });

  it("rejects unsafe consultation and candidate ids before materialization", async () => {
    await expect(
      runCrownAction({
        cwd: "/tmp/project",
        consultationId: "../run",
        candidateId: "cand-01",
        withReport: false,
      }),
    ).rejects.toThrow("Artifact ids must be safe single path segments.");
    await expect(
      runCrownAction({
        cwd: "/tmp/project",
        consultationId: "run_1",
        candidateId: "nested/cand",
        withReport: false,
      }),
    ).rejects.toThrow("Artifact ids must be safe single path segments.");
    expect(mockedMaterializeExport).not.toHaveBeenCalled();
  });

  it("crowns through the Orc action path", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-");
    const patchPath = await writeExportPatch(root, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: true,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownAction({
      cwd: root,
      materializationName: "fix/session-loss",
      candidateId: "cand-02",
      consultationId: "run_9",
      withReport: true,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      materializationName: "fix/session-loss",
      winnerId: "cand-02",
      runId: "run_9",
      withReport: true,
    });
    expect(mockedReadRunManifest).toHaveBeenCalledWith(root, "run_1");
    expect(response.mode).toBe("crown");
    expect(response.materialization).toMatchObject({
      materialized: true,
      verified: true,
      mode: "git-branch",
      materializationMode: "branch",
      branchName: "fix/session-loss",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
    });
  });
  it("forwards explicit unsafe overrides to materialization", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-allow-unsafe-");
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        safetyOverride: "operator-allow-unsafe",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    const response = await runCrownAction({
      cwd: root,
      withReport: false,
      allowUnsafe: true,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
      allowUnsafe: true,
    });
    expect(response.plan.safetyOverride).toBe("operator-allow-unsafe");
  });
  it("normalizes empty crown string inputs before materialization", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-empty-");
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await runCrownAction({
      cwd: root,
      materializationName: "   ",
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
    });
  });

  it("trims crown string inputs before materialization", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-trimmed-");
    const patchPath = await writeExportPatch(root, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    await runCrownAction({
      cwd: root,
      materializationName: "  fix/session-loss  ",
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      materializationName: "fix/session-loss",
      withReport: false,
    });
  });

  it("normalizes an empty canonical materialization name before materialization", async () => {
    const root = await createOrcActionTempRoot(
      "oraculum-orc-actions-crown-empty-materialization-name-",
    );
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await runCrownAction({
      cwd: root,
      materializationName: "   ",
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
    });
  });
  it("forwards canonical materialization names to export planning", async () => {
    const root = await createOrcActionTempRoot(
      "oraculum-orc-actions-crown-materialization-name-label-",
    );
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify({ appliedFiles: ["app.txt"], removedFiles: [] }, null, 2)}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        materializationLabel: "release-label",
        appliedPathCount: 1,
        removedPathCount: 0,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await runCrownAction({
      cwd: root,
      materializationName: "  release-label  ",
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      materializationName: "release-label",
      withReport: false,
    });
  });
  it("returns materialized branch and changed paths after crowning", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-paths-");
    const patchPath = await writeExportPatch(root, [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownAction({
      cwd: root,
      materializationName: "fix/session-loss",
      withReport: false,
    });

    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "git-branch",
      materializationMode: "branch",
      branchName: "fix/session-loss",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["README.md", "src/message.js"],
      changedPathCount: 2,
      checks: [
        expect.objectContaining({ id: "git-patch-artifact", status: "passed" }),
        expect.objectContaining({ id: "current-branch", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });
  it("reads git-branch changed paths from the export patch artifact", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-patch-");
    const patchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      patchPath,
      [
        "diff --git a/src/message.js b/src/message.js",
        "--- a/src/message.js",
        "+++ b/src/message.js",
        "@@ -1 +1 @@",
        '-export const message = "before";',
        '+export const message = "after";',
        "diff --git a/src/new-file.js b/src/new-file.js",
        "--- /dev/null",
        "+++ b/src/new-file.js",
        "@@ -0,0 +1 @@",
        "+export const added = true;",
        "",
      ].join("\n"),
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(
      createSubprocessResult({ stdout: "fix/session-loss\n" }),
    );

    const response = await runCrownAction({
      cwd: root,
      materializationName: "fix/session-loss",
      withReport: false,
    });

    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "git-branch",
      materializationMode: "branch",
      branchName: "fix/session-loss",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js", "src/new-file.js"],
      changedPathCount: 2,
      checks: [
        expect.objectContaining({ id: "git-patch-artifact", status: "passed" }),
        expect.objectContaining({ id: "current-branch", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });
  it("returns verified workspace-sync materialization from the sync summary", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-sync-");
    const summaryPath = join(root, ".oraculum", "runs", "run_1", "reports", "export-sync.json");
    await mkdir(join(root, ".oraculum", "runs", "run_1", "reports"), { recursive: true });
    await writeFile(
      summaryPath,
      `${JSON.stringify(
        {
          appliedFiles: ["app.txt", "added.txt"],
          removedFiles: ["removed.txt"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        mode: "workspace-sync",
        materializationMode: "workspace-sync",
        workspaceDir: "/tmp/workspace",
        appliedPathCount: 2,
        removedPathCount: 1,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    const response = await runCrownAction({
      cwd: root,
      withReport: false,
    });

    expect(mockedMaterializeExport).toHaveBeenCalledWith({
      cwd: root,
      withReport: false,
    });
    expect(response.materialization).toEqual({
      materialized: true,
      verified: true,
      mode: "workspace-sync",
      materializationMode: "workspace-sync",
      changedPaths: ["added.txt", "app.txt", "removed.txt"],
      changedPathCount: 3,
      checks: [
        expect.objectContaining({ id: "workspace-sync-summary", status: "passed" }),
        expect.objectContaining({ id: "changed-paths", status: "passed" }),
      ],
    });
  });
  it("rejects crowning when the current branch post-check fails", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-branch-mismatch-");
    const patchPath = await writeExportPatch(root, [
      "diff --git a/src/message.js b/src/message.js",
      "--- a/src/message.js",
      "+++ b/src/message.js",
      "@@ -1 +1 @@",
      '-export const message = "before";',
      '+export const message = "after";',
      "",
    ]);
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });
    mockedRunSubprocess.mockResolvedValueOnce(createSubprocessResult({ stdout: "main\n" }));

    await expect(
      runCrownAction({
        cwd: root,
        materializationName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('expected current git branch "fix/session-loss", received "main"');
  });
  it("rejects crowning when the git patch artifact is missing", async () => {
    const root = await createOrcActionTempRoot("oraculum-orc-actions-crown-missing-patch-");
    const missingPatchPath = join(root, ".oraculum", "runs", "run_1", "reports", "export.patch");
    mockedMaterializeExport.mockResolvedValueOnce({
      plan: {
        runId: "run_1",
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        patchPath: missingPatchPath,
        withReport: false,
        createdAt: "2026-04-05T00:00:00.000Z",
      },
      path: join(root, ".oraculum", "runs", "run_1", "reports", "export-plan.json"),
    });

    await expect(
      runCrownAction({
        cwd: root,
        materializationName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("expected branch materialization artifact does not exist");
  });
});
