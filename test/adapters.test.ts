import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("agent adapters", () => {
  it("runs Claude adapter and captures prompt/stdout/stderr artifacts", async () => {
    const root = await createTempRoot();
    const workspaceDir = join(root, "workspace");
    const logDir = join(root, "logs");
    await mkdir(workspaceDir, { recursive: true });

    const binaryPath = join(root, "fake-claude");
    await writeExecutable(
      binaryPath,
      `#!/bin/sh
printf '{"result":"Claude finished candidate patch"}'
printf 'claude stderr' >&2
`,
    );

    const adapter = new ClaudeAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-01",
      strategyId: "minimal-change",
      strategyLabel: "Minimal Change",
      workspaceDir,
      logDir,
      taskPacket: createTaskPacket(),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toContain("Claude finished candidate patch");
    await expect(readFile(join(logDir, "prompt.txt"), "utf8")).resolves.toContain("Minimal Change");
    await expect(readFile(join(logDir, "claude.stdout.txt"), "utf8")).resolves.toContain(
      "Claude finished candidate patch",
    );
    await expect(readFile(join(logDir, "claude.stderr.txt"), "utf8")).resolves.toContain(
      "claude stderr",
    );
  });

  it("runs Codex adapter and captures final message artifacts", async () => {
    const root = await createTempRoot();
    const workspaceDir = join(root, "workspace");
    const logDir = join(root, "logs");
    await mkdir(workspaceDir, { recursive: true });

    const binaryPath = join(root, "fake-codex");
    await writeExecutable(
      binaryPath,
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
printf 'codex stderr' >&2
if [ -n "$out" ]; then
  printf 'Codex finished candidate patch' > "$out"
fi
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.runCandidate({
      runId: "run_1",
      candidateId: "cand-02",
      strategyId: "safety-first",
      strategyLabel: "Safety First",
      workspaceDir,
      logDir,
      taskPacket: createTaskPacket(),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toContain("Codex finished candidate patch");
    await expect(readFile(join(logDir, "codex.final-message.txt"), "utf8")).resolves.toContain(
      "Codex finished candidate patch",
    );
    await expect(readFile(join(logDir, "codex.stdout.jsonl"), "utf8")).resolves.toContain(
      '"event":"started"',
    );
    await expect(readFile(join(logDir, "codex.stderr.txt"), "utf8")).resolves.toContain(
      "codex stderr",
    );
  });
});

function createTaskPacket() {
  return materializedTaskPacketSchema.parse({
    id: "fix-session-loss",
    title: "Fix session loss",
    intent: "Preserve login state during refresh.",
    source: {
      kind: "task-note",
      path: "/tmp/task.md",
    },
  });
}

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-adapters-"));
  tempRoots.push(path);
  return path;
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}
