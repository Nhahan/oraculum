import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { agentRunResultSchema } from "../src/adapters/types.js";
import {
  getCandidateAgentResultPath,
  getCandidateVerdictPath,
  getCandidateWitnessPath,
} from "../src/core/paths.js";
import { oracleVerdictSchema, witnessSchema } from "../src/domain/oracle.js";
import { executeRun } from "../src/services/execution.js";
import { initializeProject } from "../src/services/project.js";
import { planRun, readRunManifest } from "../src/services/runs.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("run execution", () => {
  it("executes candidates and persists agent run artifacts", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fix-session-loss.md"), "# Fix session loss\nKeep auth.\n");

    const fakeCodex = join(cwd, "fake-codex");
    await writeExecutable(
      fakeCodex,
      `#!/bin/sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
printf '{"event":"started"}\n'
if [ -n "$out" ]; then
  printf 'Codex finished candidate patch' > "$out"
fi
`,
    );

    const planned = await planRun({
      cwd,
      taskPath: "tasks/fix-session-loss.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.candidateResults[0]?.status).toBe("completed");
    expect(executed.manifest.candidates[0]?.status).toBe("promoted");
    expect(executed.manifest.candidates[0]?.workspaceMode).toBe("copy");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");
    expect(savedManifest.candidates[0]?.status).toBe("promoted");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Codex finished candidate patch");

    const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("pass");
    expect(verdict.roundId).toBe("fast");

    const witnessPath = getCandidateWitnessPath(
      cwd,
      planned.id,
      "cand-01",
      "fast",
      "cand-01-agent-exit",
    );
    const witness = witnessSchema.parse(JSON.parse(await readFile(witnessPath, "utf8")) as unknown);
    expect(witness.detail).toContain("status=completed");
    expect(savedManifest.rounds.map((round) => round.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(savedManifest.rounds[0]?.verdictCount).toBeGreaterThan(0);
    expect(savedManifest.rounds[1]?.verdictCount).toBeGreaterThan(0);
    expect(savedManifest.rounds[2]?.verdictCount).toBe(0);
  });

  it("eliminates candidates when the adapter exits non-zero", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "fail.md"), "# Fail\nReturn non-zero.\n");

    const fakeCodex = join(cwd, "fake-codex");
    await writeExecutable(
      fakeCodex,
      `#!/bin/sh
printf '{"event":"started"}\n'
exit 3
`,
    );

    const planned = await planRun({
      cwd,
      taskPath: "tasks/fail.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: fakeCodex,
      timeoutMs: 5_000,
    });

    expect(executed.candidateResults[0]?.status).toBe("failed");
    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const verdictPath = getCandidateVerdictPath(cwd, planned.id, "cand-01", "fast", "agent-exit");
    const verdict = oracleVerdictSchema.parse(
      JSON.parse(await readFile(verdictPath, "utf8")) as unknown,
    );
    expect(verdict.status).toBe("fail");
  });

  it("marks the candidate terminal and completes the run when the host binary cannot start", async () => {
    const cwd = await createTempRoot();
    await initializeProject({ cwd, force: false });
    await writeFile(join(cwd, "tasks", "missing-host.md"), "# Missing host\nFail to spawn.\n");

    const planned = await planRun({
      cwd,
      taskPath: "tasks/missing-host.md",
      agent: "codex",
      candidates: 1,
    });

    const executed = await executeRun({
      cwd,
      runId: planned.id,
      codexBinaryPath: join(cwd, "missing-codex"),
      timeoutMs: 5_000,
    });

    expect(executed.manifest.status).toBe("completed");
    expect(executed.candidateResults[0]?.status).toBe("failed");
    expect(executed.manifest.candidates[0]?.status).toBe("eliminated");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");
    expect(savedManifest.candidates[0]?.status).toBe("eliminated");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Failed to start subprocess");
    expect(savedManifest.rounds[0]?.status).toBe("completed");
    expect(savedManifest.rounds[0]?.eliminatedCount).toBe(1);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-execution-"));
  tempRoots.push(path);
  return path;
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}
