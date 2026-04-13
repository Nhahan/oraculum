import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getAdvancedConfigPath,
  getConfigPath,
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getLatestExportableRunStatePath,
  getLatestRunStatePath,
  getResearchBriefPath,
  getRunManifestPath,
  getRunsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../src/core/paths.js";
import {
  projectAdvancedConfigSchema,
  projectConfigSchema,
  projectQuickConfigSchema,
} from "../src/domain/config.js";
import {
  buildSavedConsultationStatus,
  consultationOutcomeSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
  latestRunStateSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { executeRun } from "../src/services/execution.js";
import {
  ensureProjectInitialized,
  initializeProject,
  loadProjectConfig,
} from "../src/services/project.js";
import {
  buildExportPlan,
  planRun,
  readLatestExportableRunId,
  readLatestRunId,
  readRunManifest,
} from "../src/services/runs.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";
import { normalizePathForAssertion } from "./helpers/platform.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("project scaffold", () => {
  it("initializes the default config and directories", async () => {
    const cwd = await createTempProject();

    const result = await initializeProject({ cwd, force: false });
    const configPath = getConfigPath(cwd);
    const configRaw = await readFile(configPath, "utf8");

    expect(result.configPath).toBe(configPath);
    expect(result.createdPaths).toHaveLength(4);
    expect(projectQuickConfigSchema.parse(JSON.parse(configRaw) as unknown).defaultAgent).toBe(
      "claude-code",
    );
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("merges quick-start and advanced settings into the runtime config", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 2,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(config.defaultAgent).toBe("codex");
    expect(config.defaultCandidates).toBe(2);
    expect(config.rounds).toHaveLength(3);
    expect(config.strategies).toHaveLength(4);
    expect(config.oracles[0]?.id).toBe("lint-fast");
    expect(
      projectAdvancedConfigSchema.parse(
        JSON.parse(await readFile(getAdvancedConfigPath(cwd), "utf8")) as unknown,
      ).oracles?.[0]?.id,
    ).toBe("lint-fast");
  });

  it("rejects advanced-only fields in the quick-start config", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow();
  });

  it("accepts the older full config shape for backward compatibility", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 3,
          adapters: ["claude-code", "codex"],
          strategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
              description: "Keep the diff small.",
            },
          ],
          rounds: [
            {
              id: "fast",
              label: "Fast",
              description: "Quick checks.",
            },
          ],
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(projectConfigSchema.parse(config).defaultAgent).toBe("codex");
    expect(config.rounds).toHaveLength(1);
    expect(config.oracles[0]?.id).toBe("lint-fast");
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("applies advanced overrides on top of the older full config shape", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          defaultAgent: "codex",
          defaultCandidates: 3,
          adapters: ["claude-code", "codex"],
          strategies: [
            {
              id: "minimal-change",
              label: "Minimal Change",
              description: "Keep the diff small.",
            },
          ],
          rounds: [
            {
              id: "fast",
              label: "Fast",
              description: "Quick checks.",
            },
          ],
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "impact-review",
              roundId: "impact",
              command: "npm",
              args: ["run", "test"],
              invariant: "The candidate must pass impacted review checks.",
              enforcement: "signal",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadProjectConfig(cwd);

    expect(config.defaultAgent).toBe("codex");
    expect(config.rounds).toHaveLength(1);
    expect(config.oracles).toHaveLength(1);
    expect(config.oracles[0]?.id).toBe("impact-review");
    expect(config.oracles[0]?.roundId).toBe("impact");
  });

  it("removes stale advanced settings when force init resets the project", async () => {
    const cwd = await createInitializedProject();

    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await initializeProject({ cwd, force: true });

    const config = await loadProjectConfig(cwd);
    expect(config.oracles).toHaveLength(0);
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("drops orphaned advanced settings during auto-init when quick config is missing", async () => {
    const cwd = await createTempProject();
    await mkdir(join(cwd, ".oraculum"), { recursive: true });
    await writeFile(
      getAdvancedConfigPath(cwd),
      `${JSON.stringify(
        {
          version: 1,
          oracles: [
            {
              id: "lint-fast",
              roundId: "fast",
              command: "npm",
              args: ["run", "lint"],
              invariant: "The candidate must satisfy lint checks.",
              enforcement: "hard",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await ensureProjectInitialized(cwd);

    const config = await loadProjectConfig(cwd);
    expect(config.oracles).toHaveLength(0);
    await expect(readFile(getAdvancedConfigPath(cwd), "utf8")).rejects.toThrow();
  });

  it("plans a run with candidate manifests", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 3,
    });

    const saved = runManifestSchema.parse(
      JSON.parse(await readFile(getRunManifestPath(cwd, manifest.id), "utf8")) as unknown,
    );

    expect(saved.agent).toBe("codex");
    expect(saved.candidates).toHaveLength(3);
    expect(saved.candidates[0]?.id).toBe("cand-01");
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(saved.outcome).toMatchObject({
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount: 0,
      judgingBasisKind: "unknown",
      validationPosture: "unknown",
      missingCapabilityCount: 0,
      validationGapCount: 0,
    });
    expect(buildSavedConsultationStatus(saved).nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
    ]);
    expect(buildSavedConsultationStatus(saved).validationProfileId).toBeUndefined();
    expect(buildSavedConsultationStatus(saved).validationSummary).toBeUndefined();
    expect(buildSavedConsultationStatus(saved).validationSignals).toEqual([]);
    expect(buildSavedConsultationStatus(saved).validationGaps).toEqual([]);
    expect(buildSavedConsultationStatus(saved).validationGapsPresent).toBe(false);
    expect(buildSavedConsultationStatus(saved).researchRerunRecommended).toBe(false);
    expect(buildSavedConsultationStatus(saved).researchRerunInputPath).toBeUndefined();
  });

  it("rejects conflicting legacy and validation outcome gap aliases", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "pending-execution",
        terminal: false,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        validationGapCount: 1,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("validationGapCount must match missingCapabilityCount");
  });

  it("backfills legacy outcome gap aliases from validation-first payloads", () => {
    const parsed = consultationOutcomeSchema.parse({
      type: "pending-execution",
      terminal: false,
      crownable: false,
      finalistCount: 0,
      validationPosture: "unknown",
      verificationLevel: "none",
      validationGapCount: 2,
      judgingBasisKind: "unknown",
    });

    expect(parsed.missingCapabilityCount).toBe(2);
  });

  it("rejects conflicting legacy and validation status gap-presence aliases", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "no-survivors",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        missingCapabilitiesPresent: false,
        validationGapsPresent: true,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("validationGapsPresent must match missingCapabilitiesPresent");
  });

  it("backfills legacy status gap-presence aliases from validation-first payloads", () => {
    const parsed = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "no-survivors",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "unknown",
      validationSignals: [],
      validationGaps: [],
      finalistCount: 0,
      validationGapsPresent: false,
      judgingBasisKind: "unknown",
      verificationLevel: "none",
      researchPosture: "unknown",
      nextActions: [],
      updatedAt: "2026-04-04T00:00:00.000Z",
    });

    expect(parsed.missingCapabilitiesPresent).toBe(false);
  });

  it("resolves nested invocation to the nearest initialized Oraculum root", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(join(nested, "tasks"), { recursive: true });
    await writeFile(join(nested, "tasks", "fix-session-loss.md"), "# fix nested package\n", "utf8");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 1,
    });

    expect(resolveProjectRoot(nested)).toBe(cwd);
    expect(manifest.taskPath).toBe(join(nested, "tasks", "fix-session-loss.md"));
    const saved = runManifestSchema.parse(
      JSON.parse(await readFile(getRunManifestPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(saved.taskPath).toBe(join(nested, "tasks", "fix-session-loss.md"));
  });

  it("prefers invocation-directory task files over same-named project-root task files", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(join(nested, "tasks"), { recursive: true });
    await writeFile(join(cwd, "tasks", "fix.md"), "# root task\n", "utf8");
    await writeFile(join(nested, "tasks", "fix.md"), "# nested task\n", "utf8");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix.md",
      agent: "codex",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(nested, "tasks", "fix.md"));
    expect(manifest.taskPacket.title).toBe("nested task");
  });

  it("falls back to project-root task files from nested invocations", async () => {
    const cwd = await createInitializedProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(nested, { recursive: true });
    await writeFile(join(cwd, "tasks", "fix.md"), "# root task\n", "utf8");

    const manifest = await planRun({
      cwd: nested,
      taskInput: "tasks/fix.md",
      agent: "codex",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(cwd, "tasks", "fix.md"));
    expect(manifest.taskPacket.title).toBe("root task");
  });

  it("keeps uninitialized nested directories local instead of guessing a repository root", async () => {
    const cwd = await createTempProject();
    const nested = join(cwd, "packages", "app");
    await mkdir(nested, { recursive: true });

    expect(resolveProjectRoot(nested)).toBe(nested);
  });

  it("rejects candidate counts above the supported maximum before creating a consultation", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    await expect(
      planRun({
        cwd,
        taskInput: "tasks/fix-session-loss.md",
        candidates: 17,
      }),
    ).rejects.toThrow("Candidate count must be 16 or less.");
    await expect(readdir(getRunsDir(cwd))).resolves.toEqual([]);
  });

  it("creates an export plan for a selected candidate", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
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
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

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
      timeoutMs: 5_000,
    });

    const result = await buildExportPlan({
      cwd,
      runId: manifest.id,
      winnerId: "cand-01",
      branchName: "manual-sync-label",
      withReport: true,
    });

    const saved = exportPlanSchema.parse(
      JSON.parse(await readFile(getExportPlanPath(cwd, manifest.id), "utf8")) as unknown,
    );

    expect(result.plan.winnerId).toBe("cand-01");
    expect(saved.branchName).toBeUndefined();
    expect(saved.materializationLabel).toBe("manual-sync-label");
    expect(saved.withReport).toBe(true);
    expect(saved.reportBundle?.files).toEqual(
      expect.arrayContaining([
        getFinalistComparisonJsonPath(cwd, manifest.id),
        getFinalistComparisonMarkdownPath(cwd, manifest.id),
        getWinnerSelectionPath(cwd, manifest.id),
      ]),
    );
  }, 20_000);

  it("rejects export plans for candidates that were not promoted", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        winnerId: "cand-01",
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow('status is "planned"');
  });

  it("materializes inline task input without updating latest run state before execution", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "Update src/greet.js so greet() returns Hello instead of Bye.",
      candidates: 1,
    });

    expect(normalizePathForAssertion(manifest.taskPath)).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# Update src/greet.js so greet() returns Hello instead of Bye");
    await expect(readLatestRunId(cwd)).rejects.toThrow("Start with `orc consult ...` after setup.");
    await expect(readLatestExportableRunId(cwd)).rejects.toThrow(
      "No crownable consultation found yet",
    );
  });

  it("writes a research brief artifact when preflight requires external research", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
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
    '{"decision":"external-research-required","confidence":"high","summary":"Official versioned API docs are required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the current versioned behavior?"}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    expect(manifest.preflight?.decision).toBe("external-research-required");
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief).toMatchObject({
      decision: "external-research-required",
      confidence: "high",
      researchPosture: "external-research-required",
      question:
        "What does the official API documentation say about the current versioned behavior?",
      task: manifest.taskPacket,
    });
    expect(researchBrief.sources).toEqual([]);
    expect(researchBrief.claims).toEqual([]);
    expect(researchBrief.versionNotes).toEqual([]);
    expect(researchBrief.unresolvedConflicts).toEqual([]);
    expect(researchBrief.signalSummary.length).toBeGreaterThan(0);
    expect(researchBrief.signalFingerprint).toBe(
      deriveResearchSignalFingerprint(researchBrief.signalSummary),
    );
  });

  it("accepts a persisted research brief as the next task input", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
          signalFingerprint: deriveResearchSignalFingerprint([
            "Detected explicit lint and test scripts.",
          ]),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(getResearchBriefPath(cwd, "run_research"));
    expect(manifest.taskPacket).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "research-brief",
      sourcePath: getResearchBriefPath(cwd, "run_research"),
      artifactKind: "document",
      targetArtifactPath: "docs/SESSION_PLAN.md",
      researchContext: {
        question:
          "What does the official API documentation say about the current versioned behavior?",
        summary: "Review the official versioned API docs before execution.",
        signalSummary: ["Detected explicit lint and test scripts."],
        signalFingerprint: deriveResearchSignalFingerprint([
          "Detected explicit lint and test scripts.",
        ]),
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: [],
      },
      originKind: "task-note",
      originPath: join(cwd, "tasks", "fix-session-loss.md"),
    });
  });

  it("uses repo-plus-external-docs fallback posture when preflighting a persisted research brief without runtime", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight).toMatchObject({
      decision: "proceed",
      confidence: "low",
      researchPosture: "repo-plus-external-docs",
    });
    expect(manifest.preflight?.summary).toContain(
      "Proceed conservatively using the persisted research brief plus repository evidence.",
    );
  });

  it("records research basis drift when a persisted research brief carries a stale fingerprint", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          signalSummary: ["language:typescript"],
          signalFingerprint: "stale-fingerprint",
          notes: ["Prefer official docs."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight?.decision).toBe("proceed");
    expect(manifest.preflight?.researchBasisDrift).toBe(true);
  });

  it("preserves the original task provenance when a reused research brief still needs external research", async () => {
    const cwd = await createInitializedProject();
    const originalTaskPath = join(cwd, "tasks", "fix-session-loss.md");
    await writeFile(originalTaskPath, "# fix session loss\n", "utf8");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: originalTaskPath,
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
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
    '{"decision":"external-research-required","confidence":"high","summary":"More official API documentation is required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the newly surfaced edge case?"}',
    "utf8",
  );
}
`,
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: 5_000,
      },
    });

    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief.task).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "task-note",
      sourcePath: originalTaskPath,
    });
  });

  it("guides missing project config toward host-native init first", async () => {
    const cwd = await createTempProject();

    await expect(loadProjectConfig(cwd)).rejects.toThrow('Run "orc init" after setup');
  });

  it("rejects missing task paths instead of treating them as inline text", async () => {
    const cwd = await createInitializedProject();

    await expect(
      planRun({
        cwd,
        taskInput: "tasks/missing-task.md",
        candidates: 1,
      }),
    ).rejects.toThrow("Task file not found:");
  });

  it("rejects missing source-file-looking task paths instead of treating them as inline text", async () => {
    const cwd = await createInitializedProject();

    await expect(
      planRun({
        cwd,
        taskInput: "reports/quality-review.html",
        candidates: 1,
      }),
    ).rejects.toThrow("Task file not found:");
  });

  it("rejects missing source-code-looking task paths for common non-Node extensions", async () => {
    const cwd = await createInitializedProject();

    for (const taskInput of ["src/review.py", "cmd/review.go", "crates/review.rs"]) {
      await expect(
        planRun({
          cwd,
          taskInput,
          candidates: 1,
        }),
      ).rejects.toThrow("Task file not found:");
    }
  });

  it("loads source-file-looking task paths when the file exists", async () => {
    const cwd = await createInitializedProject();
    await mkdir(join(cwd, "reports"), { recursive: true });
    await writeFile(
      join(cwd, "reports", "quality-review.html"),
      "<h1>Quality review</h1>\n<p>Inspect the report.</p>\n",
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: "reports/quality-review.html",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(join(cwd, "reports", "quality-review.html"));
    expect(manifest.taskPacket.title).toBe("quality review");
  });

  it("treats file-like inline task text without an extension as inline text", async () => {
    const cwd = await createInitializedProject();

    const manifest = await planRun({
      cwd,
      taskInput: "fix/session-loss-on-refresh",
      candidates: 1,
    });

    expect(normalizePathForAssertion(manifest.taskPath)).toContain(".oraculum/tasks/");
    const taskNote = await readFile(manifest.taskPath, "utf8");
    expect(taskNote).toContain("# fix/session-loss-on-refresh");
    expect(taskNote).toContain("fix/session-loss-on-refresh");
  });

  it("uses the latest run by default when building an export plan", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
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
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

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
      timeoutMs: 5_000,
    });

    const result = await buildExportPlan({
      cwd,
      branchName: "fix/session-loss",
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
  }, 20_000);

  it("rejects implicit export when no recommended survivor exists", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    await expect(
      buildExportPlan({
        cwd,
        runId: manifest.id,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended survivor");
  });

  it("keeps the latest exportable run when a later run is only planned", async () => {
    const cwd = await createInitializedProject();
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# fix session loss\n", "utf8");
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
if (out) {
  const body = prompt.includes("You are selecting the best Oraculum finalist.")
    ? '{"decision":"select","candidateId":"cand-01","confidence":"high","summary":"cand-01 is the recommended promotion."}'
    : "Codex finished candidate patch";
  if (!prompt.includes("You are selecting the best Oraculum finalist.")) {
    fs.writeFileSync(path.join(process.cwd(), "candidate-change.txt"), "patched\\n", "utf8");
  }
  fs.writeFileSync(out, body, "utf8");
}
`,
    );

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
      timeoutMs: 5_000,
    });

    await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    const result = await buildExportPlan({
      cwd,
      branchName: "fix/session-loss",
      withReport: false,
    });

    expect(result.plan.runId).toBe(completedRun.id);
    expect(await readLatestExportableRunId(cwd)).toBe(completedRun.id);
  });

  it("rejects older exportable runs that do not record base metadata", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "legacy-task.md"),
          taskPacket: {
            id: "task_legacy",
            title: "Legacy task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-task.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
            {
              id: "impact",
              label: "Impact",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
            {
              id: "deep",
              label: "Deep",
              status: "completed",
              verdictCount: 0,
              survivorCount: 1,
              eliminatedCount: 0,
              startedAt: createdAt,
              completedAt: createdAt,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "fallback-policy",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "workspaces", runId, "cand-01"),
              taskPacketPath: join(
                cwd,
                ".oraculum",
                "runs",
                runId,
                "candidates",
                "cand-01",
                "task-packet.json",
              ),
              workspaceMode: "git-worktree",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getLatestExportableRunStatePath(cwd),
      `${JSON.stringify({ runId, updatedAt: createdAt }, null, 2)}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        branchName: "fix/session-loss",
        withReport: false,
      }),
    ).rejects.toThrow("older consultation artifact");
  });

  it("reads legacy run manifests that do not record candidateCount", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy_manifest";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "planned",
          taskPath: join(cwd, "tasks", "legacy-task.md"),
          taskPacket: {
            id: "task_legacy",
            title: "Legacy task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-task.md"),
          },
          agent: "codex",
          createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "pending",
              verdictCount: 0,
              survivorCount: 0,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "planned",
              workspaceDir: join(cwd, ".oraculum", "workspaces", runId, "cand-01"),
              taskPacketPath: join(
                cwd,
                ".oraculum",
                "runs",
                runId,
                "candidates",
                "cand-01",
                "task-packet.json",
              ),
              createdAt,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.candidateCount).toBe(1);
    expect(manifest.candidates).toHaveLength(1);
    expect(manifest.updatedAt).toBe(createdAt);
    expect(manifest.outcome).toMatchObject({
      type: "pending-execution",
      terminal: false,
      crownable: false,
    });
  });

  it("reads blocked preflight manifests without planned candidates", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_blocked_preflight";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "blocked-task.md"),
          taskPacket: {
            id: "task_blocked",
            title: "Blocked task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "blocked-task.md"),
          },
          agent: "codex",
          candidateCount: 0,
          createdAt,
          updatedAt: createdAt,
          rounds: [],
          candidates: [],
          preflight: {
            decision: "needs-clarification",
            confidence: "medium",
            summary: "The target file is unclear.",
            researchPosture: "repo-only",
            clarificationQuestion: "Which file should Oraculum update?",
          },
          outcome: {
            type: "needs-clarification",
            terminal: true,
            crownable: false,
            finalistCount: 0,
            validationPosture: "unknown",
            verificationLevel: "none",
            missingCapabilityCount: 0,
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.candidateCount).toBe(0);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.preflight).toEqual({
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The target file is unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which file should Oraculum update?",
    });
    expect(manifest.outcome).toMatchObject({
      type: "needs-clarification",
      terminal: true,
      crownable: false,
      verificationLevel: "none",
    });
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await createTempProject();
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function createTempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(path);
  return path;
}
