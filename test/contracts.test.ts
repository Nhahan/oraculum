import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AgentAdapter, agentRunResultSchema } from "../src/adapters/types.js";
import {
  getCandidateLogsDir,
  getCandidateTaskPacketPath,
  getCandidateVerdictsDir,
  getCandidateWitnessesDir,
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import { materializedTaskPacketSchema, taskPacketSchema } from "../src/domain/task.js";
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
    expect(taskPacketSchema.parse(packet).acceptanceCriteria).toHaveLength(1);
    expect(packet.strategyHints).toContain("minimal-change");
  });
});

describe("oracle and adapter contracts", () => {
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
    };

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-01",
      workspaceDir: "/tmp/oraculum-workspace",
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
      taskPath: "tasks/fix-session-loss.md",
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
