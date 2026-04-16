import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getCandidateRepairAttemptResultPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
  getFinalistComparisonJsonPath,
  getRunManifestPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import {
  configureAdvancedConfig,
  createTempRoot,
  registerExecutionTempRootCleanup,
  writeLibraryProfileProject,
  writeWorkspaceExportableNpmLibraryProfileProject,
  writeWorkspaceLibraryProfileProject,
  writeWorkspaceLocalEntrypointProfileProject,
} from "./helpers/execution.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { EXECUTION_TEST_TIMEOUT_MS, FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";

registerExecutionTempRootCleanup();

describe("run execution repair and auto profile", () => {
  it(
    "runs a bounded repair loop for repairable verdicts before promoting a finalist",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await configureAdvancedConfig(cwd, {
        repair: {
          enabled: true,
          maxAttemptsPerRound: 1,
        },
        oracles: [
          {
            id: "needs-patch-report",
            roundId: "impact",
            command: process.execPath,
            args: [
              "-e",
              [
                "const fs = require('node:fs');",
                "const path = require('node:path');",
                "const marker = path.join(process.env.ORACULUM_CANDIDATE_WORKSPACE_DIR, 'repair-fixed.txt');",
                "if (fs.existsSync(marker)) { process.stdout.write('repair fixed'); process.exit(0); }",
                "process.stderr.write('missing repair marker'); process.exit(1);",
              ].join(" "),
            ],
            invariant: "The candidate should leave a stronger reviewable artifact after repair.",
            enforcement: "repairable",
            repairHint: "Produce the missing review marker.",
          },
        ],
      });
      await writeFile(join(cwd, "tasks", "repair-loop.md"), "# Repair loop\nRepair when needed.\n");

      const fakeCodex = await writeNodeBinary(
        cwd,
        "fake-codex",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("Repair context:")) {
  fs.writeFileSync(path.join(process.cwd(), "repair-fixed.txt"), "ok", "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 repaired its reviewable evidence."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/repair-loop.md",
        agent: "codex",
        candidates: 1,
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.candidates[0]?.status).toBe("promoted");
      expect(executed.manifest.candidates[0]?.repairCount).toBe(1);
      expect(executed.manifest.candidates[0]?.repairedRounds).toEqual(["impact"]);
      const repairResultPath = getCandidateRepairAttemptResultPath(
        cwd,
        planned.id,
        "cand-01",
        "impact",
        1,
      );
      const repairResult = agentRunResultSchema.parse(
        JSON.parse(await readFile(repairResultPath, "utf8")) as unknown,
      );
      expect(repairResult.status).toBe("completed");

      const verdictPath = getCandidateVerdictPath(
        cwd,
        planned.id,
        "cand-01",
        "impact",
        "needs-patch-report",
      );
      const verdict = oracleVerdictSchema.parse(
        JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
      );
      expect(verdict.status).toBe("pass");
      const comparison = JSON.parse(
        await readFile(getFinalistComparisonJsonPath(cwd, planned.id), "utf8"),
      ) as {
        finalists: Array<{
          candidateId: string;
          verdictCounts: { repairable: number };
        }>;
      };
      expect(comparison.finalists[0]?.candidateId).toBe("cand-01");
      expect(comparison.finalists[0]?.verdictCounts.repairable).toBeGreaterThanOrEqual(1);
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "uses consultation-scoped auto profile oracles during execution",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(join(cwd, "tasks", "fix-library.md"), "# Fix\nUpdate the library output.\n");
      await writeLibraryProfileProject(cwd);

      const fakeProfileCodex = await writeNodeBinary(
        cwd,
        "fake-codex-profile",
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
    '{"profileId":"library","confidence":"high","summary":"Library scripts are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","typecheck-fast","pack-impact","full-suite-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
      );

      const fakeCandidateCodex = await writeNodeBinary(
        cwd,
        "fake-codex-candidate",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(path.join(process.cwd(), "src", "index.js"), 'export function greet() {\\n  return "Hello";\\n}\\n', "utf8");
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-library.md",
        agent: "codex",
        candidates: 1,
        autoProfile: {
          codexBinaryPath: fakeProfileCodex,
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        },
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCandidateCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.profileSelection?.profileId).toBe("library");
      expect(executed.manifest.rounds[0]?.verdictCount).toBeGreaterThanOrEqual(4);
      expect(executed.manifest.rounds[1]?.verdictCount).toBeGreaterThanOrEqual(3);
      expect(executed.manifest.rounds[2]?.verdictCount).toBeGreaterThanOrEqual(1);
      const rawSavedManifest = JSON.parse(
        await readFile(getRunManifestPath(cwd, planned.id), "utf8"),
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

      await expect(
        readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "typecheck-fast"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "impact", "pack-impact"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "runs consultation-scoped workspace package script oracles inside the selected workspace cwd",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "fix-workspace-library.md"),
        "# Fix\nUpdate the workspace output.\n",
      );
      await writeWorkspaceLibraryProfileProject(cwd);

      const fakeProfileCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-profile",
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
    '{"profileId":"library","confidence":"high","summary":"Workspace package scripts are present.","candidateCount":3,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","full-suite-deep"],"missingCapabilities":["No package packaging smoke check was detected."]}',
    "utf8",
  );
}
`,
      );

      const fakeCandidateCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-candidate",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "app", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-workspace-library.md",
        agent: "codex",
        candidates: 1,
        autoProfile: {
          codexBinaryPath: fakeProfileCodex,
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        },
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCandidateCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.profileSelection?.profileId).toBe("library");
      expect(executed.manifest.profileSelection?.oracleIds).toEqual([
        "lint-fast",
        "full-suite-deep",
      ]);
      expect(executed.manifest.candidates[0]?.status).toBe("promoted");

      const configPath = executed.manifest.configPath;
      expect(configPath).toBeDefined();
      if (!configPath) {
        throw new Error("expected consultation config path to be recorded");
      }
      const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
        oracles?: Array<{ id: string; relativeCwd?: string; safetyRationale?: string }>;
      };
      const lintOracle = configRaw.oracles?.find((oracle) => oracle.id === "lint-fast");
      const fullSuiteOracle = configRaw.oracles?.find((oracle) => oracle.id === "full-suite-deep");
      expect(lintOracle?.relativeCwd).toBe("packages/app");
      expect(lintOracle?.safetyRationale).toContain("workspace package.json script");
      expect(fullSuiteOracle?.relativeCwd).toBe("packages/app");
      expect(fullSuiteOracle?.safetyRationale).toContain("workspace package.json script");
      await expect(
        readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateWitnessPath(cwd, planned.id, "cand-01", "fast", "cand-01-lint-fast"),
          "utf8",
        ),
      ).resolves.toContain("Safety=Uses a workspace package.json script");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "runs consultation-scoped workspace-local entrypoint oracles inside the selected workspace cwd",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "fix-workspace-entrypoints.md"),
        "# Fix\nUpdate the workspace output.\n",
      );
      await writeWorkspaceLocalEntrypointProfileProject(cwd);

      const fakeProfileCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-entrypoint-profile",
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
    '{"profileId":"library","confidence":"high","summary":"Workspace-local entrypoints are present.","candidateCount":3,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","full-suite-deep"],"missingCapabilities":["No package packaging smoke check was detected."]}',
    "utf8",
  );
}
`,
      );

      const fakeCandidateCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-entrypoint-candidate",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "app", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-workspace-entrypoints.md",
        agent: "codex",
        candidates: 1,
        autoProfile: {
          codexBinaryPath: fakeProfileCodex,
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        },
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCandidateCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.profileSelection?.profileId).toBe("library");
      expect(executed.manifest.profileSelection?.oracleIds).toEqual([
        "lint-fast",
        "full-suite-deep",
      ]);
      expect(executed.manifest.candidates[0]?.status).toBe("promoted");

      const configPath = executed.manifest.configPath;
      expect(configPath).toBeDefined();
      if (!configPath) {
        throw new Error("expected consultation config path to be recorded");
      }
      const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
        oracles?: Array<{ id: string; relativeCwd?: string }>;
      };
      expect(configRaw.oracles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "lint-fast", relativeCwd: "packages/app" }),
          expect.objectContaining({ id: "full-suite-deep", relativeCwd: "packages/app" }),
        ]),
      );
      await expect(
        readFile(
          join(
            cwd,
            ".oraculum",
            "workspaces",
            planned.id,
            "cand-01",
            "packages",
            "app",
            "lint-marker.txt",
          ),
          "utf8",
        ),
      ).resolves.toBe("lint");
      await expect(
        readFile(
          join(
            cwd,
            ".oraculum",
            "workspaces",
            planned.id,
            "cand-01",
            "packages",
            "app",
            "test-marker.txt",
          ),
          "utf8",
        ),
      ).resolves.toBe("test");
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );

  it(
    "runs workspace package export smoke oracles inside the selected workspace cwd",
    async () => {
      const cwd = await createTempRoot();
      await initializeProject({ cwd, force: false });
      await writeFile(
        join(cwd, "tasks", "fix-workspace-pack.md"),
        "# Fix\nUpdate the workspace package output.\n",
      );
      await writeWorkspaceExportableNpmLibraryProfileProject(cwd);

      const fakeProfileCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-pack-profile",
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
    '{"profileId":"library","confidence":"high","summary":"Workspace package scripts and export metadata are present.","candidateCount":4,"strategyIds":["minimal-change","test-amplified"],"selectedCommandIds":["lint-fast","pack-impact","full-suite-deep","package-smoke-deep"],"missingCapabilities":[]}',
    "utf8",
  );
}
`,
      );

      const fakeCandidateCodex = await writeNodeBinary(
        cwd,
        "fake-codex-workspace-pack-candidate",
        `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
  fs.writeFileSync(
    path.join(process.cwd(), "packages", "lib", "src", "index.js"),
    'export function greet() {\\n  return "Hello";\\n}\\n',
    "utf8",
  );
}
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the only surviving finalist."}'
    : "Codex finished candidate patch";
  fs.writeFileSync(out, body, "utf8");
}
`,
      );

      const planned = await planRun({
        cwd,
        taskInput: "tasks/fix-workspace-pack.md",
        agent: "codex",
        candidates: 1,
        autoProfile: {
          codexBinaryPath: fakeProfileCodex,
          timeoutMs: FAKE_AGENT_TIMEOUT_MS,
        },
      });

      const executed = await executeRun({
        cwd,
        runId: planned.id,
        codexBinaryPath: fakeCandidateCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      });

      expect(executed.manifest.profileSelection?.profileId).toBe("library");
      expect(executed.manifest.profileSelection?.oracleIds).toEqual([
        "lint-fast",
        "pack-impact",
        "full-suite-deep",
        "package-smoke-deep",
      ]);
      expect(executed.manifest.candidates[0]?.status).toBe("promoted");

      const configPath = executed.manifest.configPath;
      expect(configPath).toBeDefined();
      if (!configPath) {
        throw new Error("expected consultation config path to be recorded");
      }
      const configRaw = JSON.parse(await readFile(configPath, "utf8")) as {
        oracles?: Array<{ id: string; relativeCwd?: string }>;
      };
      expect(configRaw.oracles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "lint-fast", relativeCwd: "packages/lib" }),
          expect.objectContaining({ id: "pack-impact", relativeCwd: "packages/lib" }),
          expect.objectContaining({ id: "full-suite-deep", relativeCwd: "packages/lib" }),
          expect.objectContaining({ id: "package-smoke-deep", relativeCwd: "packages/lib" }),
        ]),
      );
      await expect(
        readFile(getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "lint-fast"), "utf8"),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "impact", "pack-impact"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "full-suite-deep"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
      await expect(
        readFile(
          getCandidateVerdictPath(cwd, planned.id, "cand-01", "deep", "package-smoke-deep"),
          "utf8",
        ),
      ).resolves.toContain('"status": "pass"');
    },
    EXECUTION_TEST_TIMEOUT_MS,
  );
});
