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

describe("consultation auto profile runtime: migration", () => {
  it("does not require migration-only checks when a runtime-selected migration has no migration evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "migration-runtime-no-evidence",
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
      runId: "run_migration_runtime_no_evidence",
      recommendation: {
        validationProfileId: "migration",
        confidence: "medium",
        validationSummary: "Treat this as migration work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "full-suite-deep"],
        validationGaps: [],
      },
    });

    expect(recommendation.selection.validationProfileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.selection.validationGaps).toEqual([]);
  });

  it("does not require migration-only checks when a runtime-selected migration only has detector signals", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "migration-runtime-detector-only",
          packageManager: "npm@10.0.0",
          dependencies: {
            prisma: "^5.12.0",
          },
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
      runId: "run_migration_runtime_detector_only",
      recommendation: {
        validationProfileId: "migration",
        confidence: "medium",
        validationSummary: "Treat this as migration work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "full-suite-deep"],
        validationGaps: [],
      },
    });

    expect(recommendation.selection.validationProfileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.selection.validationGaps).toEqual([]);
  });
});
