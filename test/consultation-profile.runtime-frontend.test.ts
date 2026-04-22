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

describe("consultation auto profile runtime: frontend", () => {
  it("does not require frontend-only checks when a runtime-selected frontend has no frontend evidence", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "frontend-runtime-no-evidence",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
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
      runId: "run_frontend_runtime_no_evidence",
      recommendation: {
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("requires build validation when a runtime-selected frontend has build evidence but no build command selected", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "frontend-runtime-build-evidence",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            build: "node -e \"console.log('build')\"",
            test: "node -e \"console.log('test')\"",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_frontend_runtime_build_evidence",
      recommendation: {
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("does not require frontend-only checks when a runtime-selected frontend has detector-only signals", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep it small.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "frontend-runtime-detector-only",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(cwd, "next.config.js"), "module.exports = {};\n", "utf8");

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_frontend_runtime_detector_only",
      recommendation: {
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });
});
