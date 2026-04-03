import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { agentRunResultSchema } from "../src/adapters/types.js";
import { getCandidateAgentResultPath } from "../src/core/paths.js";
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
    expect(executed.manifest.candidates[0]?.status).toBe("executed");
    expect(executed.manifest.candidates[0]?.workspaceMode).toBe("copy");

    const savedManifest = await readRunManifest(cwd, planned.id);
    expect(savedManifest.status).toBe("completed");

    const resultPath = getCandidateAgentResultPath(cwd, planned.id, "cand-01");
    const parsedResult = agentRunResultSchema.parse(
      JSON.parse(await readFile(resultPath, "utf8")) as unknown,
    );
    expect(parsedResult.summary).toContain("Codex finished candidate patch");
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
