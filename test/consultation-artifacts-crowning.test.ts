import { describe, expect, it } from "vitest";

import { getExportPlanPath } from "../src/core/paths.js";
import { exportPlanSchema } from "../src/domain/run.js";
import {
  createInitializedProject,
  ensureReportsDir,
  registerConsultationArtifactsTempRootCleanup,
  resolveBoth,
  writeJsonArtifact,
  writeTextArtifact,
} from "./helpers/consultation-artifacts.js";

registerConsultationArtifactsTempRootCleanup();

describe("consultation artifact crowning visibility", () => {
  it("hides crowning records until an exported candidate exists", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-crowning-record";
    await ensureReportsDir(cwd, runId);
    await writeJsonArtifact(
      getExportPlanPath(cwd, runId),
      exportPlanSchema.parse({
        runId,
        winnerId: "cand-01",
        branchName: `orc/${runId}-cand-01`,
        mode: "git-branch",
        materializationMode: "branch",
        workspaceDir: "/tmp/workspace",
        withReport: true,
        createdAt: "2026-04-14T00:00:00.000Z",
      }),
    );

    const hidden = await resolveBoth(cwd, runId, { hasExportedCandidate: false });
    const visible = await resolveBoth(cwd, runId, { hasExportedCandidate: true });

    for (const state of hidden) {
      expect(state.crowningRecordAvailable).toBe(false);
      expect(state.crowningRecordPath).toBeUndefined();
    }

    for (const state of visible) {
      expect(state.crowningRecordAvailable).toBe(true);
      expect(state.crowningRecordPath).toBe(getExportPlanPath(cwd, runId));
    }
  });

  it("hides invalid export plans even when an exported candidate exists", async () => {
    const cwd = await createInitializedProject();
    const runId = "run-invalid-crowning-record";
    await ensureReportsDir(cwd, runId);
    await writeTextArtifact(getExportPlanPath(cwd, runId), "{\n");

    for (const state of await resolveBoth(cwd, runId, { hasExportedCandidate: true })) {
      expect(state.crowningRecordAvailable).toBe(false);
      expect(state.crowningRecordPath).toBeUndefined();
    }
  });
});
