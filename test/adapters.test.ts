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
prompt=$(cat)
if [ -z "$prompt" ]; then
  printf 'missing prompt' >&2
  exit 9
fi
printf '{"result":"Claude finished candidate patch","summary":"'"$prompt"'"}'
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
    expect(result.summary).toContain("Minimal Change");
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
prompt=$(cat)
if [ -z "$prompt" ]; then
  printf 'missing prompt' >&2
  exit 9
fi
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
printf '{"event":"started"}\n'
printf 'codex stderr' >&2
if [ -n "$out" ]; then
  printf 'Codex finished candidate patch: %s' "$prompt" > "$out"
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
    expect(result.summary).toContain("Safety First");
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

  it("asks Codex to recommend a winner and parses structured output", async () => {
    const root = await createTempRoot();
    const logDir = join(root, "judge-logs");

    const binaryPath = join(root, "fake-codex");
    await writeExecutable(
      binaryPath,
      `#!/bin/sh
out=""
prev=""
prompt=$(cat)
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
printf '{"event":"started"}\n'
if [ -n "$out" ]; then
  printf '{"candidateId":"cand-02","confidence":"medium","summary":"cand-02 preserved the strongest evidence."}' > "$out"
fi
printf '%s' "$prompt" >/dev/null
`,
    );

    const adapter = new CodexAdapter({
      binaryPath,
      timeoutMs: 5_000,
    });

    const result = await adapter.recommendWinner({
      runId: "run_1",
      projectRoot: root,
      logDir,
      taskPacket: createTaskPacket(),
      finalists: [
        {
          candidateId: "cand-01",
          strategyLabel: "Minimal Change",
          summary: "Small diff.",
          artifactKinds: ["report"],
          verdicts: [],
        },
        {
          candidateId: "cand-02",
          strategyLabel: "Safety First",
          summary: "More evidence.",
          artifactKinds: ["report", "transcript"],
          verdicts: [],
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.recommendation?.candidateId).toBe("cand-02");
    expect(result.recommendation?.confidence).toBe("medium");
    await expect(
      readFile(join(logDir, "winner-judge.final-message.txt"), "utf8"),
    ).resolves.toContain('"candidateId":"cand-02"');
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
