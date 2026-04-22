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
  readProfileSelectionArtifact,
  recommendRuntimeProfile,
  registerConsultationProfileTempRootCleanup,
  writeLibraryPackage,
} from "./helpers/consultation-profile.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerConsultationProfileTempRootCleanup();

describe("consultation auto profile runtime: persistence and planning", () => {
  it(
    "applies an auto-selected library profile when quick-start settings are still implicit",
    async () => {
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
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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
      expect(savedManifest.profileSelection?.missingCapabilities).toEqual([]);

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
      expect(savedConfig.oracles?.every((oracle) => typeof oracle.timeoutMs === "number")).toBe(
        true,
      );
      expect(savedConfig.oracles?.map((oracle) => oracle.id)).not.toContain("package-smoke-deep");
      expect(savedManifest.profileSelection?.validationProfileId).toBe("library");
      expect(savedManifest.profileSelection?.validationSummary).toBe(
        "Library scripts and package export signals are strongest.",
      );
      expect(savedManifest.profileSelection?.validationSignals).toEqual([
        "repo-local-validation",
        "package-export-metadata",
      ]);
      expect(savedManifest.profileSelection?.validationGaps).toEqual([]);

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

      const selectionArtifact = await readProfileSelectionArtifact<{
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
      }>(cwd, manifest.id);
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
      expect(selectionArtifact.appliedSelection.validationGaps).toEqual([]);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "does not require package export smoke when a runtime-selected library has no export metadata",
    async () => {
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
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        },
      });

      expect(manifest.profileSelection?.profileId).toBe("library");
      expect(manifest.profileSelection?.oracleIds).toEqual([
        "lint-fast",
        "typecheck-fast",
        "full-suite-deep",
      ]);
      expect(manifest.profileSelection?.missingCapabilities).toEqual([]);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

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

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_unsupported_runtime_posture",
      recommendation: {
        validationProfileId: "docs-review",
        confidence: "high",
        validationSummary: "Docs review signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change"],
        selectedCommandIds: ["lint-fast"],
        validationGaps: [],
      },
    });

    expect(recommendation.selection.profileId).toBe("generic");
    expect(recommendation.selection.source).toBe("fallback-detection");

    const selectionArtifact = await readProfileSelectionArtifact<{
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
    }>(cwd, "run_unsupported_runtime_posture");

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
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
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

    const recommendation = await recommendRuntimeProfile({
      cwd,
      runId: "run_profile",
      recommendation: {
        profileId: "library",
        confidence: "high",
        summary: "Library defaults fit this repository.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        selectedCommandIds: ["lint-fast", "typecheck-fast", "unit-impact", "full-suite-deep"],
        missingCapabilities: [],
      },
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
    expect(recommendation.selection.missingCapabilities).toEqual([]);
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
});
