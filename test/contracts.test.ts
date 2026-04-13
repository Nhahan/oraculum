import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AgentAdapter,
  agentJudgeResultSchema,
  agentProfileResultSchema,
  agentRunResultSchema,
} from "../src/adapters/types.js";
import {
  getCandidateLogsDir,
  getCandidateTaskPacketPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
} from "../src/core/paths.js";
import {
  projectAdvancedConfigSchema,
  projectConfigSchema,
  projectQuickConfigSchema,
} from "../src/domain/config.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import {
  deriveResearchSignalFingerprint,
  deriveTaskPacketId,
  materializedTaskPacketSchema,
  taskPacketSchema,
} from "../src/domain/task.js";
import { initializeProject } from "../src/services/project.js";
import { planRun } from "../src/services/runs.js";
import { loadTaskPacket } from "../src/services/task-packets.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("task packet contracts", () => {
  it("materializes a markdown task note into a task packet", async () => {
    const root = await createTempProject();
    const taskPath = join(root, "fix-session-loss.md");
    await writeFile(taskPath, "# Fix session loss\nPreserve login state during refresh.\n", "utf8");

    const packet = await loadTaskPacket(taskPath);

    expect(packet.source.kind).toBe("task-note");
    expect(packet.title).toBe("Fix session loss");
    expect(packet.intent).toContain("Preserve login state");
    expect(materializedTaskPacketSchema.parse(packet).id).toBe("fix-session-loss");
  });

  it("derives stable non-collapsing ids from non-English task filenames", async () => {
    const root = await createTempProject();
    const taskPath = join(root, "사업화_준비도_검토보고서.md");
    await writeFile(taskPath, "# 보고서 검토\nHTML 품질을 검토한다.\n", "utf8");

    const packet = await loadTaskPacket(taskPath);

    expect(packet.id).toMatch(/^사업화-준비도-검토보고서-[a-f0-9]{8}$/u);
  });

  it("derives non-English task ids independent of the absolute checkout path", () => {
    const filename = "사업화_준비도_검토보고서.md";

    expect(deriveTaskPacketId(join("/tmp/a", filename))).toBe(
      deriveTaskPacketId(join("/tmp/b", filename)),
    );
  });

  it("derives readable ids from task filenames with spaces and no extension", async () => {
    const root = await createTempProject();
    const taskPath = join(root, "fix session loss");
    await writeFile(taskPath, "Preserve login state during refresh.\n", "utf8");

    const packet = await loadTaskPacket(taskPath);

    expect(packet.id).toBe("fix-session-loss");
    expect(packet.title).toBe("fix session loss");
  });

  it("loads a structured task packet from JSON", async () => {
    const root = await createTempProject();
    const taskPath = join(root, "task-packet.json");
    await writeFile(
      taskPath,
      `${JSON.stringify(
        {
          id: "session-loss",
          title: "Fix session loss",
          intent: "Preserve login state during refresh.",
          artifactKind: "document",
          targetArtifactPath: "docs/SESSION_PLAN.md",
          nonGoals: ["Do not redesign auth."],
          acceptanceCriteria: ["Refresh keeps the active session."],
          risks: ["Cookie scoping"],
          oracleHints: ["auth-guard", "session-regression"],
          strategyHints: ["minimal-change", "safety-first"],
          contextFiles: ["src/auth/session.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const packet = await loadTaskPacket(taskPath);

    expect(packet.source.kind).toBe("task-packet");
    expect(packet.artifactKind).toBe("document");
    expect(packet.targetArtifactPath).toBe("docs/SESSION_PLAN.md");
    expect(taskPacketSchema.parse(packet).acceptanceCriteria).toHaveLength(1);
    expect(packet.strategyHints).toContain("minimal-change");
  });

  it("loads an external research brief into a reusable task packet", async () => {
    const root = await createTempProject();
    const taskPath = join(root, "research-brief.json");
    await writeFile(
      taskPath,
      `${JSON.stringify(
        {
          decision: "external-research-required",
          question: "What does the official API documentation say about the current behavior?",
          confidence: "high",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "session-loss",
            title: "Fix session loss",
            sourceKind: "task-note",
            sourcePath: join(root, "fix-session-loss.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          signalFingerprint: deriveResearchSignalFingerprint([
            "Detected package.json and explicit lint/test scripts.",
          ]),
          sources: [
            {
              kind: "official-doc",
              title: "Current API docs",
              locator: "https://example.com/docs/current-api",
            },
          ],
          claims: [
            {
              statement: "The current API requires a version header on session refresh.",
              sourceLocators: ["https://example.com/docs/current-api"],
            },
          ],
          versionNotes: ["Behavior changed in v3.2 compared with the legacy session API."],
          unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
          notes: ["Prefer official docs over third-party blog posts."],
          signalSummary: ["Detected package.json and explicit lint/test scripts."],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const packet = await loadTaskPacket(taskPath);

    expect(packet.source.kind).toBe("research-brief");
    expect(packet.source.originKind).toBe("task-note");
    expect(packet.source.originPath).toBe(join(root, "fix-session-loss.md"));
    expect(packet.artifactKind).toBe("document");
    expect(packet.targetArtifactPath).toBe("docs/SESSION_PLAN.md");
    expect(packet.researchContext).toMatchObject({
      question: "What does the official API documentation say about the current behavior?",
      summary: "Review the official versioned API docs before execution.",
      confidence: "high",
      signalSummary: ["Detected package.json and explicit lint/test scripts."],
      signalFingerprint: deriveResearchSignalFingerprint([
        "Detected package.json and explicit lint/test scripts.",
      ]),
      sources: [
        {
          kind: "official-doc",
          title: "Current API docs",
          locator: "https://example.com/docs/current-api",
        },
      ],
    });
    expect(packet.id).toBe("session-loss");
    expect(packet.title).toBe("Fix session loss");
    expect(packet.intent).toContain("Research question:");
    expect(packet.intent).toContain("Review the official versioned API docs before execution.");
    expect(packet.intent).toContain("Research sources:");
    expect(packet.intent).toContain(
      "- [official-doc] Current API docs — https://example.com/docs/current-api",
    );
    expect(packet.intent).toContain("Research claims:");
    expect(packet.intent).toContain(
      "- The current API requires a version header on session refresh. (sources: https://example.com/docs/current-api)",
    );
    expect(packet.intent).toContain("Version notes:");
    expect(packet.intent).toContain(
      "- Behavior changed in v3.2 compared with the legacy session API.",
    );
    expect(packet.intent).toContain("Unresolved conflicts:");
    expect(packet.intent).toContain(
      "- The repo comments still describe the pre-v3.2 refresh flow.",
    );
    expect(packet.contextFiles).toEqual([join(root, "fix-session-loss.md")]);
  });
});

describe("oracle and adapter contracts", () => {
  it("keeps quick-start config minimal", () => {
    const quick = projectQuickConfigSchema.parse({
      version: 1,
      defaultAgent: "codex",
      defaultCandidates: 2,
    });

    expect(quick.defaultAgent).toBe("codex");
    expect(Object.keys(quick)).toEqual(["version", "defaultAgent", "defaultCandidates"]);
  });

  it("accepts advanced operator settings separately from quick-start defaults", () => {
    const advanced = projectAdvancedConfigSchema.parse({
      version: 1,
      managedTree: {
        includePaths: ["dist", "target/docs"],
        excludePaths: ["build"],
      },
      repair: {
        enabled: true,
        maxAttemptsPerRound: 1,
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
    });

    expect(advanced.oracles?.[0]?.args).toEqual(["run", "lint"]);
    expect(advanced.managedTree?.includePaths).toEqual(["dist", "target/docs"]);
    expect(advanced.repair?.maxAttemptsPerRound).toBe(1);
  });

  it("rejects unsafe managed tree include and exclude paths", () => {
    for (const path of ["../outside", "packages/../outside", "/tmp/outside", "C:\\tmp"]) {
      expect(() =>
        projectAdvancedConfigSchema.parse({
          version: 1,
          managedTree: {
            includePaths: [path],
            excludePaths: [],
          },
        }),
      ).toThrow("Managed tree paths must be safe relative paths");
    }
  });

  it("supports repo-local command oracle configuration", () => {
    const config = projectConfigSchema.parse(
      buildProjectConfigWithOracle({
        id: "lint-fast",
        roundId: "fast",
        command: "npm run lint",
        invariant: "The candidate must satisfy lint checks.",
        enforcement: "hard",
        safetyRationale: "The repository declares this lint command explicitly.",
      }),
    );

    expect(config.oracles[0]?.cwd).toBe("workspace");
    expect(config.oracles[0]?.confidence).toBe("medium");
    expect(config.oracles[0]?.pathPolicy).toBe("local-only");
    expect(config.oracles[0]?.safetyRationale).toBe(
      "The repository declares this lint command explicitly.",
    );
    expect(config.repair.maxAttemptsPerRound).toBe(1);
  });

  it("requires explicit oracle path policy before inheriting global PATH", () => {
    const config = projectConfigSchema.parse(
      buildProjectConfigWithOracle({
        id: "global-tool",
        roundId: "impact",
        command: "tool-from-path",
        args: ["--check"],
        invariant: "The operator explicitly allows global PATH lookup.",
        pathPolicy: "inherit",
      }),
    );

    expect(config.oracles[0]?.pathPolicy).toBe("inherit");
  });

  it("accepts safe repo-local oracle relative cwd values", () => {
    const config = projectConfigSchema.parse(
      buildProjectConfigWithOracle({
        id: "workspace-package",
        roundId: "impact",
        command: "npm",
        args: ["test"],
        invariant: "Nested package checks must pass.",
        cwd: "workspace",
        relativeCwd: "packages/app",
      }),
    );

    expect(config.oracles[0]?.relativeCwd).toBe("packages/app");
  });

  it("rejects repo-local oracle relative cwd traversal and absolute paths", () => {
    for (const relativeCwd of ["../outside", "packages/../outside", "/tmp/outside", "C:\\tmp"]) {
      expect(() =>
        projectConfigSchema.parse(
          buildProjectConfigWithOracle({
            id: "unsafe-cwd",
            roundId: "impact",
            command: "npm",
            args: ["test"],
            invariant: "Unsafe cwd must be rejected.",
            cwd: "workspace",
            relativeCwd,
          }),
        ),
      ).toThrow("relativeCwd must be a safe relative path");
    }
  });

  it("rejects repo-local oracle ids that collide within a round or with built-ins", () => {
    expect(() =>
      projectConfigSchema.parse({
        version: 1,
        defaultAgent: "claude-code",
        defaultCandidates: 4,
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
            id: "agent-exit",
            roundId: "fast",
            command: "true",
            invariant: "Must not shadow built-in oracle ids.",
          },
          {
            id: "agent-exit",
            roundId: "fast",
            command: "true",
            invariant: "Must not duplicate repo-local oracle ids either.",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects repo-local oracle ids that shadow newer built-in impact checks", () => {
    expect(() =>
      projectConfigSchema.parse({
        version: 1,
        defaultAgent: "claude-code",
        defaultCandidates: 4,
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
            id: "impact",
            label: "Impact",
            description: "Impact checks.",
          },
        ],
        oracles: [
          {
            id: "materialized-patch",
            roundId: "impact",
            command: "true",
            invariant: "Must not shadow built-in materialized patch checks.",
          },
        ],
        repair: {
          enabled: true,
          maxAttemptsPerRound: 1,
        },
      }),
    ).toThrow();
  });

  it("validates oracle verdicts with witnesses", () => {
    const witness = witnessSchema.parse({
      id: "w-1",
      kind: "test",
      title: "Session regression test",
      detail: "session refresh test fails before the patch",
      scope: ["src/auth/session.ts"],
    });

    const verdict = oracleVerdictSchema.parse({
      oracleId: "session-regression",
      roundId: "impact",
      status: "repairable",
      severity: "error",
      summary: "Session refresh still drops auth state.",
      invariant: "Refreshing the page must keep the active session.",
      confidence: "high",
      repairHint: "Check cookie persistence and session restore ordering.",
      affectedScope: ["src/auth/session.ts"],
      witnesses: [witness],
    });

    expect(verdict.witnesses[0]?.id).toBe("w-1");
  });

  it("supports a typed adapter result contract", async () => {
    const adapter: AgentAdapter = {
      name: "codex",
      async runCandidate(request) {
        return agentRunResultSchema.parse({
          runId: request.runId,
          candidateId: request.candidateId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-03T00:00:00.000Z",
          completedAt: "2026-04-03T00:00:01.000Z",
          exitCode: 0,
          summary: "Stub adapter run completed.",
          artifacts: [],
        });
      },
      async recommendWinner(request) {
        return agentJudgeResultSchema.parse({
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-03T00:00:00.000Z",
          completedAt: "2026-04-03T00:00:01.000Z",
          exitCode: 0,
          summary: "Stub judge selected a winner.",
          recommendation: {
            candidateId: request.finalists[0]?.candidateId ?? "cand-01",
            confidence: "medium",
            summary: "Stub judge recommendation.",
          },
          artifacts: [],
        });
      },
      async recommendPreflight(request) {
        return {
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-03T00:00:00.000Z",
          completedAt: "2026-04-03T00:00:01.000Z",
          exitCode: 0,
          summary: "Stub adapter preflight completed.",
          recommendation: {
            decision: "proceed",
            confidence: "medium",
            summary: "Repository context is sufficient.",
            researchPosture: "repo-only",
          },
          artifacts: [],
        };
      },
      async recommendProfile(request) {
        return agentProfileResultSchema.parse({
          runId: request.runId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-03T00:00:00.000Z",
          completedAt: "2026-04-03T00:00:01.000Z",
          exitCode: 0,
          summary: "Stub profile recommendation completed.",
          recommendation: {
            profileId: "library",
            confidence: "medium",
            summary: "Stub profile recommendation.",
            candidateCount: 4,
            strategyIds: ["minimal-change", "test-amplified"],
            selectedCommandIds: [],
            missingCapabilities: [],
          },
          artifacts: [],
        });
      },
    };

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-01",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir: "/tmp/oraculum-workspace",
      logDir: "/tmp/oraculum-logs",
      taskPacket: materializedTaskPacketSchema.parse({
        id: "session-loss",
        title: "Fix session loss",
        intent: "Preserve login state during refresh.",
        source: {
          kind: "task-note",
          path: "/tmp/task.md",
        },
      }),
    });

    expect(result.status).toBe("completed");
  });
});

describe("run scaffold artifacts", () => {
  it("writes task packet and candidate artifact directories during planning", async () => {
    const cwd = await createTempProject();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# Fix session loss\nKeep auth.\n");

    const run = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      candidates: 1,
    });

    const candidate = run.candidates[0];
    if (!candidate) {
      throw new Error("Expected the run to create a candidate.");
    }

    const taskPacketRaw = await readFile(
      getCandidateTaskPacketPath(cwd, run.id, candidate.id),
      "utf8",
    );
    const taskPacket = materializedTaskPacketSchema.parse(JSON.parse(taskPacketRaw) as unknown);

    expect(taskPacket.title).toBe("Fix session loss");
    await expect(stat(getCandidateVerdictsDir(cwd, run.id, candidate.id))).resolves.toBeTruthy();
    await expect(stat(getCandidateWitnessesDir(cwd, run.id, candidate.id))).resolves.toBeTruthy();
    await expect(stat(getCandidateLogsDir(cwd, run.id, candidate.id))).resolves.toBeTruthy();
  });
});

async function createTempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-contracts-"));
  tempRoots.push(path);
  return path;
}

function buildProjectConfigWithOracle(oracle: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    defaultAgent: "claude-code",
    defaultCandidates: 4,
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
      {
        id: "impact",
        label: "Impact",
        description: "Impact checks.",
      },
    ],
    oracles: [oracle],
    repair: {
      enabled: true,
      maxAttemptsPerRound: 1,
    },
  };
}
