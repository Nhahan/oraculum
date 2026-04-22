import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getRunManifestPath } from "../src/core/paths.js";
import { type RunManifest, runManifestSchema } from "../src/domain/run.js";
import { materializeExport } from "../src/services/exports.js";
import { initializeProject, writeJsonFile } from "../src/services/project.js";
import { createTempRoot } from "./helpers/exports.js";
import { writeManualWorkspaceSyncWinner } from "./helpers/exports-workspace-sync.js";
import { writeUnavailableSecondOpinionSelection } from "./helpers/run-artifacts.js";

describe("crown safety gate", () => {
  it("blocks validation gaps unless the operator explicitly allows unsafe crowning", async () => {
    const cwd = await createCrownableWorkspaceSyncRun("run_validation_gap");
    await updateRunManifest(cwd, "run_validation_gap", (manifest) => {
      const outcome = requireOutcome(manifest);
      return {
        ...manifest,
        profileSelection: {
          validationProfileId: "generic",
          profileId: "generic",
          confidence: "low",
          source: "fallback-detection",
          validationSummary: "No repo-local validation command was selected.",
          summary: "No repo-local validation command was selected.",
          candidateCount: 1,
          strategyIds: ["minimal-change"],
          oracleIds: [],
          validationSignals: [],
          signals: [],
          validationGaps: ["No repo-local validation command was selected."],
          missingCapabilities: ["No repo-local validation command was selected."],
        },
        outcome: {
          ...outcome,
          validationGapCount: 1,
          missingCapabilityCount: 1,
          validationPosture: "validation-gaps",
          judgingBasisKind: "missing-capability",
        },
      };
    });

    await expect(
      materializeExport({
        cwd,
        runId: "run_validation_gap",
        withReport: false,
      }),
    ).rejects.toThrow("validation gap");

    const result = await materializeExport({
      cwd,
      runId: "run_validation_gap",
      withReport: false,
      allowUnsafe: true,
    });

    expect(result.plan.safetyOverride).toBe("operator-allow-unsafe");
    expect(await readFile(join(cwd, "app.txt"), "utf8")).toBe("patched\n");
  });

  it("blocks fallback-policy recommendations by default", async () => {
    const cwd = await createCrownableWorkspaceSyncRun("run_fallback_policy");
    await updateRunManifest(cwd, "run_fallback_policy", (manifest) => {
      const recommendedWinner = requireRecommendedWinner(manifest);
      return {
        ...manifest,
        recommendedWinner: {
          ...recommendedWinner,
          source: "fallback-policy",
        },
      };
    });

    await expect(
      materializeExport({
        cwd,
        runId: "run_fallback_policy",
        withReport: false,
      }),
    ).rejects.toThrow("fallback-policy");
  });

  it("blocks unavailable second-opinion results by default", async () => {
    const cwd = await createCrownableWorkspaceSyncRun("run_second_opinion");
    await writeUnavailableSecondOpinionSelection(cwd, "run_second_opinion");

    await expect(
      materializeExport({
        cwd,
        runId: "run_second_opinion",
        withReport: false,
      }),
    ).rejects.toThrow("second-opinion judge requires manual review");
  });
});

async function createCrownableWorkspaceSyncRun(runId: string): Promise<string> {
  const cwd = await createTempRoot();
  await initializeProject({ cwd, force: false });
  await writeFile(join(cwd, "app.txt"), "original\n", "utf8");
  await writeManualWorkspaceSyncWinner({
    cwd,
    runId,
    workspaceSetup: async (workspaceDir) => {
      await writeFile(join(workspaceDir, "app.txt"), "patched\n", "utf8");
    },
  });
  return cwd;
}

async function updateRunManifest(
  cwd: string,
  runId: string,
  updater: (manifest: RunManifest) => RunManifest,
): Promise<void> {
  const manifestPath = getRunManifestPath(cwd, runId);
  const manifest = runManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  await writeJsonFile(manifestPath, runManifestSchema.parse(updater(manifest)));
}

function requireOutcome(manifest: RunManifest): NonNullable<RunManifest["outcome"]> {
  if (!manifest.outcome) {
    throw new Error("expected manifest outcome");
  }
  return manifest.outcome;
}

function requireRecommendedWinner(
  manifest: RunManifest,
): NonNullable<RunManifest["recommendedWinner"]> {
  if (!manifest.recommendedWinner) {
    throw new Error("expected manifest recommended winner");
  }
  return manifest.recommendedWinner;
}
