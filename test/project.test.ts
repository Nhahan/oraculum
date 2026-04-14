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
  getPreflightReadinessPath,
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
import { parseRunManifestArtifact } from "../src/services/run-manifest-artifact.js";
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
          judge: {
            secondOpinion: {
              enabled: true,
              adapter: "claude-code",
              triggers: ["judge-abstain", "many-changed-paths"],
              minChangedPaths: 2,
              minChangedLines: 120,
            },
          },
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
    expect(config.judge.secondOpinion).toMatchObject({
      enabled: true,
      adapter: "claude-code",
      triggers: ["judge-abstain", "many-changed-paths"],
      minChangedPaths: 2,
      minChangedLines: 120,
    });
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

  it("omits inspect-comparison-report when saved status is built with unavailable comparison artifacts", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 2,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "promoted",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
          {
            id: "cand-02",
            strategyId: "safety-first",
            strategyLabel: "Safety First",
            status: "promoted",
            workspaceDir: "/tmp/cand-02",
            taskPacketPath: "/tmp/cand-02/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
          finalistCount: 2,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      },
      {
        comparisonReportAvailable: false,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("omits direct crown when saved status is built with required manual review", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "promoted",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        manualReviewRequired: true,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
  });

  it("omits direct crown when a crowning record already exists", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        crowningRecordAvailable: true,
      },
    );

    expect(status.nextActions).toEqual(["reopen-verdict", "browse-archive"]);
  });

  it("keeps manual review explicit when a crowning record already exists", () => {
    const status = buildSavedConsultationStatus(
      {
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-05T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/cand-01",
            taskPacketPath: "/tmp/cand-01/task.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-05T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          validationPosture: "sufficient",
          verificationLevel: "standard",
          missingCapabilityCount: 0,
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
          recommendedCandidateId: "cand-01",
        },
      },
      {
        crowningRecordAvailable: true,
        manualReviewRequired: true,
      },
    );

    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "perform-manual-review",
    ]);
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

  it("normalizes legacy crown-recommended-survivor next actions to crown-recommended-result", () => {
    const parsed = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "sufficient",
      finalistCount: 1,
      validationGapsPresent: false,
      judgingBasisKind: "repo-local-oracle",
      verificationLevel: "lightweight",
      researchPosture: "repo-only",
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-survivor"],
      recommendedCandidateId: "cand-01",
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    expect(parsed.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "crown-recommended-result",
    ]);
  });

  it("backfills researchConflictHandling from persisted research status signals", () => {
    const conflicted = savedConsultationStatusSchema.parse({
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "external-research-required",
      terminal: true,
      crownable: false,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      researchRerunRecommended: true,
      researchConflictsPresent: true,
      validationPosture: "validation-gaps",
      finalistCount: 0,
      validationGapsPresent: false,
      judgingBasisKind: "missing-capability",
      verificationLevel: "none",
      researchPosture: "external-research-required",
      nextActions: ["gather-external-research-and-rerun"],
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    const current = savedConsultationStatusSchema.parse({
      consultationId: "run_2",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "research-brief",
      taskSourcePath: "/tmp/research-brief.json",
      researchSignalCount: 1,
      researchSignalFingerprint: "fingerprint",
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      validationPosture: "sufficient",
      finalistCount: 1,
      validationGapsPresent: false,
      judgingBasisKind: "repo-local-oracle",
      verificationLevel: "lightweight",
      researchPosture: "repo-plus-external-docs",
      nextActions: ["reopen-verdict", "crown-recommended-result"],
      recommendedCandidateId: "cand-01",
      validationSignals: [],
      validationGaps: [],
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    expect(conflicted.researchConflictHandling).toBe("manual-review-required");
    expect(conflicted.researchBasisStatus).toBe("current");
    expect(current.researchConflictHandling).toBe("accepted");
  });

  it("rejects outcome payloads that omit both legacy and validation gap counts", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "pending-execution",
        terminal: false,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      }),
    ).toThrow();
  });

  it("rejects recommended-survivor outcomes that omit the recommended candidate id", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow("recommendedCandidateId is required when outcome type is recommended-survivor");
  });

  it("rejects non-recommended outcomes that still include a recommended candidate id", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        recommendedCandidateId: "cand-01",
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcome type is recommended-survivor");
  });

  it("rejects outcome and status payloads whose terminal or crownable flags contradict the outcome type", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: false,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow("terminal must be true when outcome type is recommended-survivor");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "needs-clarification",
        terminal: true,
        crownable: true,
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
      }),
    ).toThrow("crownable must be false when outcomeType is needs-clarification");
  });

  it("rejects survivor-style outcomes that omit finalists", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 0,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      }),
    ).toThrow(
      "recommended-survivor and finalists-without-recommendation outcomes require finalistCount to be at least 1",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "finalists-without-recommendation",
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
      }),
    ).toThrow(
      "recommended-survivor and finalists-without-recommendation statuses require finalistCount to be at least 1",
    );
  });

  it("rejects non-finalist outcome and status payloads that still report finalists", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 1,
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("no-survivors outcomes require finalistCount to be 0");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "needs-clarification",
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
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("needs-clarification statuses require finalistCount to be 0");
  });

  it("rejects gap-type outcome and status payloads whose validation-gap semantics disagree", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "missing-capability",
      }),
    ).toThrow(
      "completed-with-validation-gaps outcomes require validationGapCount to be at least 1",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "missing-capability",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("completed-with-validation-gaps statuses require validationGapsPresent to be true");

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "missing-capability",
      }),
    ).toThrow(
      "completed-with-validation-gaps outcomes require validationPosture to be validation-gaps",
    );

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("no-survivors outcomes cannot use validation-gaps validationPosture");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: true,
        judgingBasisKind: "missing-capability",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "completed-with-validation-gaps statuses require validationPosture to be validation-gaps",
    );

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
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("no-survivors statuses cannot use validation-gaps validationPosture");
  });

  it("rejects blocked-preflight outcome and status payloads whose validationPosture disagrees with the blocked state", () => {
    expect(() =>
      consultationOutcomeSchema.parse({
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow(
      "external-research-required outcomes require validationPosture to be validation-gaps",
    );

    expect(() =>
      consultationOutcomeSchema.parse({
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "none",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      }),
    ).toThrow("needs-clarification outcomes require validationPosture to be unknown");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "external-research-required",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: true,
        researchConflictsPresent: false,
        validationPosture: "unknown",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "external-research-required",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "external-research-required statuses require validationPosture to be validation-gaps",
    );

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "abstained-before-execution",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("abstained-before-execution statuses require validationPosture to be unknown");
  });

  it("rejects status payloads whose preflightDecision disagrees with the blocked outcome type", () => {
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
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        preflightDecision: "needs-clarification",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("preflightDecision needs-clarification requires outcomeType needs-clarification");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "external-research-required",
        terminal: true,
        crownable: false,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        preflightDecision: "proceed",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("preflightDecision proceed cannot use a blocked preflight outcomeType");
  });

  it("rejects status payloads whose consultationState disagrees with outcomeType", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "planned",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        recommendedCandidateId: "cand-01",
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("planned consultation statuses must use outcomeType pending-execution");

    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "running",
        terminal: false,
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
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow(
      "completed consultation statuses cannot use outcomeType pending-execution or running",
    );
  });

  it("rejects status payloads whose validation-gaps flag disagrees with the gap list", () => {
    expect(
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "validation-gaps",
        validationSignals: [],
        validationGaps: [],
        recommendedCandidateId: "cand-01",
        finalistCount: 1,
        validationGapsPresent: true,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toMatchObject({
      outcomeType: "recommended-survivor",
      validationGapsPresent: true,
      validationGaps: [],
    });

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
        validationGaps: ["No build validation command was selected."],
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("validationGapsPresent must be true when detailed validationGaps are present");
  });

  it("allows legacy validation-gap statuses that only know the gap count", () => {
    const status = buildSavedConsultationStatus({
      id: "run_legacy_gap_status",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 0,
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        validationGapCount: 1,
        judgingBasisKind: "missing-capability",
      },
    });

    expect(status.outcomeType).toBe("completed-with-validation-gaps");
    expect(status.validationGapsPresent).toBe(true);
    expect(status.validationGaps).toEqual([]);
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

  it("rejects status payloads that omit both legacy and validation gap-presence aliases", () => {
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
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects recommended-survivor status payloads that omit the recommended candidate id", () => {
    expect(() =>
      savedConsultationStatusSchema.parse({
        consultationId: "run_1",
        consultationState: "completed",
        outcomeType: "recommended-survivor",
        terminal: true,
        crownable: true,
        taskSourceKind: "task-note",
        taskSourcePath: "/tmp/task.md",
        researchSignalCount: 0,
        researchRerunRecommended: false,
        researchConflictsPresent: false,
        validationPosture: "sufficient",
        validationSignals: [],
        validationGaps: [],
        finalistCount: 1,
        validationGapsPresent: false,
        judgingBasisKind: "repo-local-oracle",
        verificationLevel: "standard",
        researchPosture: "repo-only",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("recommendedCandidateId is required when outcomeType is recommended-survivor");
  });

  it("rejects non-recommended status payloads that still include a recommended candidate id", () => {
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
        recommendedCandidateId: "cand-01",
        finalistCount: 0,
        validationGapsPresent: false,
        judgingBasisKind: "unknown",
        verificationLevel: "none",
        researchPosture: "unknown",
        nextActions: [],
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
    ).toThrow("recommendedCandidateId is only allowed when outcomeType is recommended-survivor");
  });

  it("derives outcome gaps from validation-first profile selections in legacy manifest normalization", () => {
    const parsed = parseRunManifestArtifact({
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      profileSelection: {
        validationProfileId: "frontend",
        confidence: "medium",
        source: "llm-recommendation",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: [],
        validationSignals: ["frontend-config"],
        validationGaps: ["No build validation command was selected."],
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.validationPosture).toBe("validation-gaps");
  });

  it("backfills outcome gap aliases for legacy manifests that already persisted an outcome", () => {
    const parsed = parseRunManifestArtifact({
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      profileSelection: {
        validationProfileId: "frontend",
        confidence: "medium",
        source: "llm-recommendation",
        validationSummary: "Frontend evidence is strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: [],
        validationSignals: ["frontend-config"],
        validationGaps: ["No build validation command was selected."],
      },
      outcome: {
        type: "completed-with-validation-gaps",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        judgingBasisKind: "missing-capability",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(1);
    expect(parsed.outcome?.missingCapabilityCount).toBe(1);
    expect(parsed.outcome?.type).toBe("completed-with-validation-gaps");
  });

  it("backfills zero validation gaps for legacy blocked outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact({
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 0,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("needs-clarification");
  });

  it("backfills zero validation gaps for legacy external-research outcomes without persisted counts", () => {
    const parsed = parseRunManifestArtifact({
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 0,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        judgingBasisKind: "unknown",
      },
    });

    expect(parsed.outcome?.validationGapCount).toBe(0);
    expect(parsed.outcome?.missingCapabilityCount).toBe(0);
    expect(parsed.outcome?.type).toBe("external-research-required");
  });

  it("backfills the recommended candidate id for legacy survivor outcomes", () => {
    const parsed = parseRunManifestArtifact({
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task",
        title: "Task",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-04T00:00:00.000Z",
      rounds: [],
      candidates: [],
      recommendedWinner: {
        candidateId: "cand-01",
        summary: "cand-01 is the recommended promotion.",
        confidence: "high",
        source: "llm-judge",
      },
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        validationPosture: "sufficient",
        verificationLevel: "standard",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
    });

    expect(parsed.outcome?.recommendedCandidateId).toBe("cand-01");
  });

  it("rejects manifests whose recommended winner disagrees with the outcome survivor id", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        recommendedWinner: {
          candidateId: "cand-02",
          summary: "cand-02 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommendedWinner.candidateId must match outcome.recommendedCandidateId when both are present.",
    );
  });

  it("rejects planned manifests that persist a terminal outcome", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "planned",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow("planned manifests must use the pending-execution outcome type");
  });

  it("rejects completed manifests that still persist nonterminal outcome types", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "running",
          terminal: false,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("completed manifests cannot use pending-execution or running outcome types");
  });

  it("rejects manifests whose candidateCount does not match the persisted candidates", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 2,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "candidateCount must match the number of persisted candidates when candidate records are present",
    );
  });

  it("rejects manifests whose finalistCount does not match promoted or exported candidates", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 0,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "outcome.finalistCount must match the number of promoted or exported candidates when candidate records are present",
    );
  });

  it("rejects manifests that persist a recommended winner for non-survivor outcomes", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        recommendedWinner: {
          candidateId: "cand-01",
          summary: "cand-01 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "no-survivors",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("recommendedWinner is only allowed when outcome type is recommended-survivor");
  });

  it("rejects manifests whose recommended survivor is not promoted or exported", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "planned",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommended survivors must reference a promoted or exported candidate when that candidate is present in the manifest",
    );
  });

  it("rejects manifests whose recommended survivor does not exist in persisted candidate records", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-02",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "exported",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        outcome: {
          type: "recommended-survivor",
          terminal: true,
          crownable: true,
          finalistCount: 1,
          recommendedCandidateId: "cand-01",
          validationPosture: "sufficient",
          verificationLevel: "standard",
          validationGapCount: 0,
          judgingBasisKind: "repo-local-oracle",
        },
      }),
    ).toThrow(
      "recommended survivors must reference a persisted candidate when candidate records are present in the manifest",
    );
  });

  it("rejects conflicting persisted outcome gap aliases during manifest normalization", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        outcome: {
          type: "completed-with-validation-gaps",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          judgingBasisKind: "missing-capability",
          validationGapCount: 1,
          missingCapabilityCount: 2,
        },
      }),
    ).toThrow("validationGapCount must match missingCapabilityCount");
  });

  it("rejects manifests whose outcome gap count disagrees with persisted profile selection gaps", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        profileSelection: {
          validationProfileId: "frontend",
          confidence: "medium",
          source: "llm-recommendation",
          validationSummary: "Frontend evidence is strongest.",
          candidateCount: 1,
          strategyIds: ["minimal-change"],
          oracleIds: [],
          validationSignals: ["frontend-config"],
          validationGaps: ["No build validation command was selected."],
        },
        outcome: {
          type: "completed-with-validation-gaps",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "missing-capability",
        },
      }),
    ).toThrow(
      "outcome.validationGapCount must match profileSelection validation gaps when a persisted profile selection is present",
    );
  });

  it("rejects manifests whose blocked preflight decision disagrees with the persisted outcome type", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
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
          type: "no-survivors",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow(
      "blocked preflight decision needs-clarification requires outcome type needs-clarification",
    );

    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "proceed",
          confidence: "high",
          summary: "Repository evidence is sufficient to continue.",
          researchPosture: "repo-only",
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("preflight decision proceed cannot persist a blocked preflight outcome type");
  });

  it("rejects blocked preflight manifests that still persist candidates or recommendations", () => {
    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 1,
        createdAt: "2026-04-04T00:00:00.000Z",
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
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist candidateCount above 0");

    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [
          {
            id: "cand-01",
            strategyId: "minimal-change",
            strategyLabel: "Minimal Change",
            status: "planned",
            workspaceDir: "/tmp/workspace",
            taskPacketPath: "/tmp/task-packet.json",
            repairCount: 0,
            repairedRounds: [],
            createdAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        preflight: {
          decision: "external-research-required",
          confidence: "high",
          summary: "Official docs are required before execution.",
          researchPosture: "external-research-required",
          researchQuestion:
            "What does the official API documentation say about the current behavior?",
        },
        outcome: {
          type: "external-research-required",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "validation-gaps",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist candidate records");

    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [],
        candidates: [],
        preflight: {
          decision: "abstain",
          confidence: "medium",
          summary: "The repository setup is not executable yet.",
          researchPosture: "repo-only",
        },
        recommendedWinner: {
          candidateId: "cand-01",
          summary: "cand-01 is the recommended promotion.",
          confidence: "high",
          source: "llm-judge",
        },
        outcome: {
          type: "abstained-before-execution",
          terminal: true,
          crownable: false,
          finalistCount: 0,
          validationPosture: "unknown",
          verificationLevel: "none",
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests cannot persist a recommended winner");

    expect(() =>
      parseRunManifestArtifact({
        id: "run_1",
        status: "completed",
        taskPath: "/tmp/task.md",
        taskPacket: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        agent: "codex",
        candidateCount: 0,
        createdAt: "2026-04-04T00:00:00.000Z",
        rounds: [
          {
            id: "fast",
            label: "Fast",
            status: "completed",
            verdictCount: 0,
            survivorCount: 0,
            eliminatedCount: 0,
          },
        ],
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
          validationGapCount: 0,
          judgingBasisKind: "unknown",
        },
      }),
    ).toThrow("blocked preflight manifests must not persist execution rounds");
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
    expect(researchBrief.conflictHandling).toBe("accepted");
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
          runId: "run_research",
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
        conflictHandling: "accepted",
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
          runId: "run_research",
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

  it("rejects persisted research briefs whose conflict handling disagrees with unresolved conflicts", () => {
    expect(() =>
      consultationResearchBriefSchema.parse({
        runId: "run_invalid_conflict_handling",
        decision: "external-research-required",
        question: "What does the official API documentation say?",
        confidence: "medium",
        researchPosture: "repo-plus-external-docs",
        summary: "Review the official versioned API docs before execution.",
        task: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
        conflictHandling: "accepted",
        notes: [],
        signalSummary: [],
      }),
    ).toThrow(
      "conflictHandling must match unresolvedConflicts: use manual-review-required when conflicts exist, otherwise accepted.",
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
          runId: "run_research",
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
    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, manifest.id), "utf8"),
    ) as {
      researchBasis?: {
        status?: string;
        refreshAction?: string;
      };
    };
    expect(readiness.researchBasis?.status).toBe("stale");
    expect(readiness.researchBasis?.refreshAction).toBe("refresh-before-rerun");
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
          runId: "run_research",
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

  it("rejects implicit export with artifact-aware wording when the task targets a repo artifact", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_document_without_winner";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "copy",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("does not have a recommended document result for docs/SESSION_PLAN.md");
  });

  it("preserves absolute target artifact paths outside the project root in export guidance", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_external_document_without_winner";
    const createdAt = "2026-04-06T00:00:00.000Z";
    const externalTargetArtifactPath = join(tmpdir(), "external", "SESSION_PLAN.md");
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_external_document",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: externalTargetArtifactPath,
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "copy",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "repo-local-oracle",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      `does not have a recommended document result for ${externalTargetArtifactPath.replaceAll("\\", "/")}`,
    );
  });

  it("accepts implicit export for legacy survivor manifests that only persist outcome survivor ids", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy_survivor";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "legacy-survivor.md"),
          taskPacket: {
            id: "task_legacy_survivor",
            title: "Legacy survivor task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-survivor.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "exported",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01"),
              taskPacketPath: join(cwd, ".oraculum", "tasks", "legacy-survivor.json"),
              workspaceMode: "copy",
              baseSnapshotPath: join(cwd, ".oraculum", "runs", runId, "cand-01-base"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await buildExportPlan({
      cwd,
      runId,
      withReport: false,
    });

    expect(result.plan.runId).toBe(runId);
    expect(result.plan.winnerId).toBe("cand-01");
    expect(result.plan.mode).toBe("workspace-sync");
    expect(result.plan.materializationMode).toBe("workspace-sync");
  });

  it("backfills legacy export aliases from canonical materialization fields", () => {
    const plan = exportPlanSchema.parse({
      runId: "run_alias_only",
      winnerId: "cand-01",
      branchName: "fix/session-loss",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      materializationPatchPath: "/tmp/export.patch",
      withReport: false,
      createdAt: "2026-04-06T00:00:00.000Z",
    });

    expect(plan.mode).toBe("git-branch");
    expect(plan.materializationMode).toBe("branch");
    expect(plan.patchPath).toBe("/tmp/export.patch");
    expect(plan.materializationPatchPath).toBe("/tmp/export.patch");
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
    ).rejects.toThrow("git base revision needed for branch materialization");
  });

  it("requires a branch name when materializing a branch-backed recommended result", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_branch_materialization";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "branch-backed.md"),
          taskPacket: {
            id: "task_branch",
            title: "Branch-backed task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "branch-backed.md"),
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "llm-judge",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              workspaceMode: "git-worktree",
              baseRevision: "abc123",
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow("Branch materialization requires a target branch name");
  });

  it("uses artifact-aware guidance when a recommended result lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_missing_materialization_mode";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document_mode",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          recommendedWinner: {
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
            source: "llm-judge",
          },
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-01", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-01", "task-packet.json"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "recommended-survivor",
            terminal: true,
            crownable: true,
            finalistCount: 1,
            recommendedCandidateId: "cand-01",
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-01" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
  });

  it("uses selected-finalist guidance when an explicit crown target lacks a recorded materialization mode", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_selected_finalist_missing_materialization_mode";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "draft-plan.md"),
          taskPacket: {
            id: "task_document_selected_mode",
            title: "Draft plan",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "draft-plan.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          agent: "codex",
          candidateCount: 1,
          createdAt,
          updatedAt: createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "completed",
              verdictCount: 1,
              survivorCount: 1,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-02",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "promoted",
              workspaceDir: join(cwd, ".oraculum", "runs", runId, "cand-02", "workspace"),
              taskPacketPath: join(cwd, ".oraculum", "runs", runId, "cand-02", "task-packet.json"),
              repairCount: 0,
              repairedRounds: [],
              createdAt,
            },
          ],
          outcome: {
            type: "finalists-without-recommendation",
            terminal: true,
            crownable: false,
            finalistCount: 1,
            validationPosture: "sufficient",
            verificationLevel: "lightweight",
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      buildExportPlan({
        cwd,
        runId,
        winnerId: "cand-02",
        withReport: false,
      }),
    ).rejects.toThrow(
      'Candidate "cand-02" does not record a crowning materialization mode. Re-run the consultation before materializing it.',
    );
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

  it("reconstructs blocked preflight outcomes when legacy manifests only persisted preflight", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_blocked_preflight_legacy";
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
            decision: "external-research-required",
            confidence: "high",
            summary: "Official docs are required before execution.",
            researchPosture: "external-research-required",
            researchQuestion:
              "What does the official API documentation say about the current behavior?",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.preflight).toMatchObject({
      decision: "external-research-required",
      confidence: "high",
    });
    expect(manifest.outcome).toMatchObject({
      type: "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "validation-gaps",
      validationGapCount: 0,
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
