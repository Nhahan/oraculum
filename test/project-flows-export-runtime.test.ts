import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import { exportPlanSchema, latestRunStateSchema } from "../src/domain/run.js";
import { executeRun } from "../src/services/execution.js";
import { buildExportPlan, planRun, readLatestExportableRunId } from "../src/services/runs.js";
import { FAKE_AGENT_TIMEOUT_MS, PROJECT_FLOWS_TEST_TIMEOUT_MS } from "./helpers/integration.js";
import {
  createInitializedProject,
  createWinnerSelectingCodexBinary,
  registerProjectFlowsTempRootCleanup,
  writeProjectFlowFile,
} from "./helpers/project-flows.js";

registerProjectFlowsTempRootCleanup();

describe("project flows export runtime", () => {
  it(
    "creates an export plan for a selected candidate",
    async () => {
      const cwd = await createInitializedProject();
      await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
      const fakeCodex = await createWinnerSelectingCodexBinary(cwd);

      const manifest = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 2,
      });
      await executeRun({
        cwd,
        runId: manifest.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await buildExportPlan({
        cwd,
        runId: manifest.id,
        winnerId: "cand-01",
        materializationName: "manual-sync-label",
        withReport: true,
      });

      const saved = exportPlanSchema.parse(
        JSON.parse(await readFile(getExportPlanPath(cwd, manifest.id), "utf8")) as unknown,
      );

      expect(result.plan.winnerId).toBe("cand-01");
      expect(saved.branchName).toBeUndefined();
      expect(saved.materializationMode).toBe("workspace-sync");
      expect(saved.materializationLabel).toBe("manual-sync-label");
      expect(saved.withReport).toBe(true);
      expect(saved.reportBundle?.files).toEqual(
        expect.arrayContaining([
          getFinalistComparisonJsonPath(cwd, manifest.id),
          getFinalistComparisonMarkdownPath(cwd, manifest.id),
          getWinnerSelectionPath(cwd, manifest.id),
        ]),
      );
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );

  it(
    "uses the latest run by default when building an export plan",
    async () => {
      const cwd = await createInitializedProject();
      await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
      const fakeCodex = await createWinnerSelectingCodexBinary(cwd);

      const manifest = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });
      await executeRun({
        cwd,
        runId: manifest.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      const result = await buildExportPlan({
        cwd,
        materializationName: "fix/session-loss",
        withReport: true,
      });

      expect(result.plan.runId).toBe(manifest.id);
      expect(result.plan.winnerId).toBe("cand-01");
      expect(result.plan.reportBundle?.files).toEqual(
        expect.arrayContaining([
          getFinalistComparisonJsonPath(cwd, manifest.id),
          getFinalistComparisonMarkdownPath(cwd, manifest.id),
        ]),
      );

      const latestRunState = latestRunStateSchema.parse(
        JSON.parse(await readFile(getLatestRunStatePath(cwd), "utf8")) as unknown,
      );
      expect(latestRunState.runId).toBe(manifest.id);

      const latestExportableRunState = latestRunStateSchema.parse(
        JSON.parse(await readFile(getLatestExportableRunStatePath(cwd), "utf8")) as unknown,
      );
      expect(latestExportableRunState.runId).toBe(manifest.id);
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );

  it(
    "keeps the latest exportable run when a later run is only planned",
    async () => {
      const cwd = await createInitializedProject();
      await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
      const fakeCodex = await createWinnerSelectingCodexBinary(cwd);

      const completedRun = await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        agent: "codex",
        candidates: 1,
      });
      await executeRun({
        cwd,
        runId: completedRun.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      await planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        candidates: 1,
      });

      const result = await buildExportPlan({
        cwd,
        materializationName: "fix/session-loss",
        withReport: false,
      });

      expect(result.plan.runId).toBe(completedRun.id);
      expect(await readLatestExportableRunId(cwd)).toBe(completedRun.id);
    },
    PROJECT_FLOWS_TEST_TIMEOUT_MS,
  );
});
