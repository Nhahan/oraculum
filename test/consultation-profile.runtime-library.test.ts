import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initializeProject } from "../src/services/project.js";
import {
  createTempRoot,
  recommendRuntimeProfile,
  registerConsultationProfileTempRootCleanup,
} from "./helpers/consultation-profile.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile runtime: library", () => {
  it("does not require a full-suite deep test when a runtime-selected library has no deep-test evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep the package healthy.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "demo-library-no-deep-test",
          packageManager: "npm@10.0.0",
          type: "module",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_library_no_deep_test",
      recommendation: {
        profileId: "library",
        confidence: "high",
        summary: "Library signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "typecheck-fast"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("does not require a full-suite deep test when a runtime-selected library only has detector test-runner signals", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep the package healthy.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "demo-library-detector-test-runner-only",
          packageManager: "npm@10.0.0",
          type: "module",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "playwright.config.ts"), "export default {};\n", "utf8");

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_library_detector_test_runner_only",
      recommendation: {
        profileId: "library",
        confidence: "high",
        summary: "Library signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "typecheck-fast"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("reports unselected repo-local validation when a generic runtime recommendation omits commands", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "generic-runtime-empty-selection",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_generic_runtime_empty_selection",
      recommendation: {
        profileId: "generic",
        confidence: "medium",
        summary: "Keep the generic profile.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: [],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No repo-local validation command was selected.",
    ]);
  });
});
