import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAdvancedConfigPath,
  getConfigPath,
  getProfileSelectionPath,
  getReportsDir,
  getRunManifestPath,
} from "../src/core/paths.js";
import { recommendConsultationProfile } from "../src/services/consultation-profile.js";
import {
  initializeProject,
  loadProjectConfig,
  loadProjectConfigLayers,
} from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";
import { loadTaskPacket } from "../src/services/task-packets.js";
import {
  createNoopProfileAdapter,
  createTempRoot,
  registerConsultationProfileTempRootCleanup,
  writeLibraryPackage,
} from "./helpers/consultation-profile.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile runtime", () => {
  it("applies an auto-selected library profile when quick-start settings are still implicit", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts and package export signals are strongest.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","unit-impact","full-suite-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix.md",
      agent: "codex",
      autoProfile: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.profileSelection?.profileId).toBe("library");
    expect(manifest.candidateCount).toBe(4);
    expect(manifest.profileSelection?.strategyIds).toEqual([
      "minimal-change",
      "test-amplified",
      "minimal-change-3",
      "test-amplified-4",
    ]);
    const savedManifest = await readRunManifest(cwd, manifest.id);
    expect(savedManifest.profileSelection?.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(savedManifest.profileSelection?.missingCapabilities).toEqual([
      "No package packaging smoke check was selected.",
    ]);
    const configPath = savedManifest.configPath;
    expect(configPath).toBeDefined();
    if (!configPath) {
      throw new Error("expected consultation config path to be recorded");
    }
    const savedConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      oracles?: Array<{
        id: string;
        args?: string[];
        command?: string;
        timeoutMs?: number;
        safetyRationale?: string;
      }>;
    };
    expect(
      savedConfig.oracles?.filter(
        (oracle) => oracle.command === "npm" && oracle.args?.join(" ") === "run test",
      ),
    ).toHaveLength(1);
    expect(savedConfig.oracles?.every((oracle) => typeof oracle.timeoutMs === "number")).toBe(true);
    expect(savedConfig.oracles?.map((oracle) => oracle.id)).not.toContain("package-smoke-deep");
    expect(savedManifest.profileSelection?.validationProfileId).toBe("library");
    expect(savedManifest.profileSelection?.validationSummary).toBe(
      "Library scripts and package export signals are strongest.",
    );
    expect(savedManifest.profileSelection?.validationSignals).toEqual([
      "repo-local-validation",
      "package-export-metadata",
    ]);
    expect(savedManifest.profileSelection?.validationGaps).toEqual([
      "No package packaging smoke check was selected.",
    ]);
    const rawSavedManifest = JSON.parse(
      await readFile(getRunManifestPath(cwd, manifest.id), "utf8"),
    ) as {
      profileSelection?: {
        profileId?: string;
        summary?: string;
        signals?: string[];
        missingCapabilities?: string[];
      };
    };
    expect(rawSavedManifest.profileSelection).not.toHaveProperty("profileId");
    expect(rawSavedManifest.profileSelection).not.toHaveProperty("summary");
    expect(rawSavedManifest.profileSelection).not.toHaveProperty("signals");
    expect(rawSavedManifest.profileSelection).not.toHaveProperty("missingCapabilities");
    const selectionArtifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, manifest.id), "utf8"),
    ) as {
      recommendation: {
        profileId?: string;
        summary?: string;
        missingCapabilities?: string[];
      };
      llmResult?: {
        recommendation?: {
          profileId?: string;
          summary?: string;
          missingCapabilities?: string[];
        };
      };
      appliedSelection: {
        profileId?: string;
        summary?: string;
        signals?: string[];
        missingCapabilities?: string[];
        validationProfileId: string;
        validationSummary: string;
        validationSignals: string[];
        validationGaps: string[];
      };
    };
    expect(selectionArtifact.recommendation).not.toHaveProperty("profileId");
    expect(selectionArtifact.recommendation).not.toHaveProperty("summary");
    expect(selectionArtifact.recommendation).not.toHaveProperty("missingCapabilities");
    expect(selectionArtifact.llmResult?.recommendation).not.toHaveProperty("profileId");
    expect(selectionArtifact.llmResult?.recommendation).not.toHaveProperty("summary");
    expect(selectionArtifact.llmResult?.recommendation).not.toHaveProperty("missingCapabilities");
    expect(selectionArtifact.appliedSelection).not.toHaveProperty("profileId");
    expect(selectionArtifact.appliedSelection).not.toHaveProperty("summary");
    expect(selectionArtifact.appliedSelection).not.toHaveProperty("signals");
    expect(selectionArtifact.appliedSelection).not.toHaveProperty("missingCapabilities");
    expect(selectionArtifact.appliedSelection.validationProfileId).toBe("library");
    expect(selectionArtifact.appliedSelection.validationSummary).toBe(
      "Library scripts and package export signals are strongest.",
    );
    expect(selectionArtifact.appliedSelection.validationSignals).toEqual([
      "repo-local-validation",
      "package-export-metadata",
    ]);
    expect(selectionArtifact.appliedSelection.validationGaps).toEqual([
      "No package packaging smoke check was selected.",
    ]);
  });

  it("does not require package export smoke when a runtime-selected library has no export metadata", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep the package healthy.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "demo-library-no-exports",
          packageManager: "npm@10.0.0",
          type: "module",
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

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts are strongest.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","unit-impact","full-suite-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix.md",
      agent: "codex",
      autoProfile: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.profileSelection?.profileId).toBe("library");
    expect(manifest.profileSelection?.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(manifest.profileSelection?.missingCapabilities).toEqual([]);
  });

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
    await mkdir(getReportsDir(cwd, "run_library_no_deep_test"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "library",
        confidence: "high",
        summary: "Library signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_library_no_deep_test"),
      runId: "run_library_no_deep_test",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
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
    await mkdir(getReportsDir(cwd, "run_library_detector_test_runner_only"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "library",
        confidence: "high",
        summary: "Library signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_library_detector_test_runner_only"),
      runId: "run_library_detector_test_runner_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("library");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "typecheck-fast"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

  it("falls back when runtime returns an unsupported validation posture id", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nKeep docs grounded.\n", "utf8");
    await writeFile(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "unsupported-runtime-posture",
          packageManager: "npm@10.0.0",
          scripts: {
            lint: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(getReportsDir(cwd, "run_unsupported_runtime_posture"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        validationProfileId: "docs-review",
        confidence: "high",
        validationSummary: "Docs review signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast"],
        validationGaps: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_unsupported_runtime_posture"),
      runId: "run_unsupported_runtime_posture",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.source).toBe("fallback-detection");

    const selectionArtifact = JSON.parse(
      await readFile(getProfileSelectionPath(cwd, "run_unsupported_runtime_posture"), "utf8"),
    ) as {
      recommendation: {
        validationProfileId: string;
        validationSummary: string;
      };
      llmResult?: {
        recommendation?: {
          validationProfileId: string;
          validationSummary: string;
        };
      };
    };

    expect(selectionArtifact.recommendation.validationProfileId).toBe("generic");
    expect(selectionArtifact.recommendation.validationSummary).toContain("Fallback detection");
    expect(selectionArtifact.llmResult?.recommendation?.validationProfileId).toBe("docs-review");
    expect(selectionArtifact.llmResult?.recommendation?.validationSummary).toBe(
      "Docs review signals are strongest.",
    );
  });

  it("keeps explicit quick and advanced settings while still recording the auto profile decision", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify({ version: 1, defaultCandidates: 2 }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "custom-impact",
              roundId: "impact",
              command: "npm",
              args: ["run", "test"],
              invariant: "Custom test check.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const fakeCodex = await writeNodeBinary(
      cwd,
      "fake-codex",
      `const fs = require("node:fs");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (out) {
  fs.writeFileSync(
    out,
    '{"profileId":"library","confidence":"high","summary":"Library scripts are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix.md",
      agent: "codex",
      autoProfile: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.candidateCount).toBe(2);
    expect(manifest.profileSelection?.profileId).toBe("library");
    expect(manifest.profileSelection?.oracleIds).toEqual(["custom-impact"]);
    expect(manifest.profileSelection?.missingCapabilities).toEqual([]);
    expect(manifest.profileSelection?.strategyIds).toEqual(["minimal-change", "test-amplified"]);
  });

  it("generates workspace-scoped profile oracles for consultation defaults", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_profile"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "library",
        confidence: "high",
        summary: "Library defaults fit this repository.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "unit-impact", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_profile"),
      runId: "run_profile",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.config.oracles).toHaveLength(3);
    expect(recommendation.config.oracles.every((oracle) => oracle.cwd === "workspace")).toBe(true);
    expect(recommendation.config.oracles.every((oracle) => oracle.timeoutMs !== undefined)).toBe(
      true,
    );
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No package packaging smoke check was selected.",
    ]);
  });

  it("can skip runtime profile selection and rely on fallback detection for planning-only flows", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix.md"), "# Fix\nChange the greeting.\n", "utf8");
    await writeLibraryPackage(cwd);
    await mkdir(getReportsDir(cwd, "run_draft"), { recursive: true });

    let called = false;
    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter(undefined, () => {
        called = true;
      }),
      allowRuntime: false,
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_draft"),
      runId: "run_draft",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(called).toBe(false);
    expect(recommendation.selection.source).toBe("fallback-detection");
    expect(recommendation.selection.strategyIds).toEqual(["minimal-change", "safety-first"]);
    await expect(readFile(getProfileSelectionPath(cwd, "run_draft"), "utf8")).resolves.toContain(
      '"llmSkipped": true',
    );
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
    await mkdir(getReportsDir(cwd, "run_generic_runtime_empty_selection"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "generic",
        confidence: "medium",
        summary: "Keep the generic profile.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: [],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_generic_runtime_empty_selection"),
      runId: "run_generic_runtime_empty_selection",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.oracleIds).toEqual([]);
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No repo-local validation command was selected.",
    ]);
  });

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
    await mkdir(getReportsDir(cwd, "run_frontend_runtime_no_evidence"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend_runtime_no_evidence"),
      runId: "run_frontend_runtime_no_evidence",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
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
    await mkdir(getReportsDir(cwd, "run_frontend_runtime_build_evidence"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend_runtime_build_evidence"),
      runId: "run_frontend_runtime_build_evidence",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([
      "No build validation command was selected.",
    ]);
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
    await mkdir(getReportsDir(cwd, "run_frontend_runtime_detector_only"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "frontend",
        confidence: "medium",
        summary: "Treat this as frontend work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_frontend_runtime_detector_only"),
      runId: "run_frontend_runtime_detector_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("frontend");
    expect(recommendation.selection.oracleIds).toEqual([
      "lint-fast",
      "typecheck-fast",
      "full-suite-deep",
    ]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });

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
    await mkdir(getReportsDir(cwd, "run_migration_runtime_no_evidence"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "migration",
        confidence: "medium",
        summary: "Treat this as migration work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_migration_runtime_no_evidence"),
      runId: "run_migration_runtime_no_evidence",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
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
    await mkdir(getReportsDir(cwd, "run_migration_runtime_detector_only"), { recursive: true });

    const recommendation = await recommendConsultationProfile({
      adapter: createNoopProfileAdapter({
        profileId: "migration",
        confidence: "medium",
        summary: "Treat this as migration work.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast", "full-suite-deep"],
        missingCapabilities: [],
      }),
      baseConfig: await loadProjectConfig(cwd),
      configLayers: await loadProjectConfigLayers(cwd),
      projectRoot: cwd,
      reportsDir: getReportsDir(cwd, "run_migration_runtime_detector_only"),
      runId: "run_migration_runtime_detector_only",
      taskPacket: await loadTaskPacket(join(cwd, "tasks", "fix.md")),
    });

    expect(recommendation.selection.profileId).toBe("migration");
    expect(recommendation.selection.oracleIds).toEqual(["lint-fast", "full-suite-deep"]);
    expect(recommendation.selection.missingCapabilities).toEqual([]);
  });
});
