import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error host-native smoke is an untyped ESM script.
import { waitForCompletedRun, waitForExportPlan } from "../scripts/host-native-smoke.mjs";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("host-native smoke polling", () => {
  it("waits until the latest run manifest reaches completed status", async () => {
    const root = await createTempRoot();
    const runId = "run_wait_complete";
    const runDir = join(root, ".oraculum", "runs", runId);
    await mkdir(runDir, { recursive: true });

    const settled = waitForCompletedRun(root, {
      label: "codex consult",
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    setTimeout(async () => {
      await writeJson(join(root, ".oraculum", "latest-run.json"), { runId });
      await writeJson(join(runDir, "run.json"), {
        id: runId,
        status: "running",
      });
      setTimeout(async () => {
        await writeJson(join(runDir, "run.json"), {
          id: runId,
          status: "completed",
          candidates: [],
        });
      }, 25).unref();
    }, 25).unref();

    await expect(settled).resolves.toEqual({
      runId,
      manifest: {
        id: runId,
        status: "completed",
        candidates: [],
      },
    });
  });

  it("waits until the export plan exists and the run records an exported candidate", async () => {
    const root = await createTempRoot();
    const runId = "run_wait_export";
    const reportsDir = join(root, ".oraculum", "runs", runId, "reports");
    await mkdir(reportsDir, { recursive: true });
    await writeJson(join(root, ".oraculum", "runs", runId, "run.json"), {
      id: runId,
      status: "completed",
      candidates: [{ id: "cand-01", status: "promoted" }],
    });

    const settled = waitForExportPlan(root, runId, {
      label: "codex crown",
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    setTimeout(async () => {
      await writeJson(join(reportsDir, "export-plan.json"), {
        runId,
        candidateId: "cand-01",
        mode: "workspace-sync",
      });
      setTimeout(async () => {
        await writeJson(join(root, ".oraculum", "runs", runId, "run.json"), {
          id: runId,
          status: "completed",
          candidates: [{ id: "cand-01", status: "exported" }],
        });
      }, 25).unref();
    }, 25).unref();

    await expect(settled).resolves.toBeUndefined();
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oraculum-host-native-smoke-test-"));
  tempRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
