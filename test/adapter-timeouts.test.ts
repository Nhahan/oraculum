import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { runSubprocess } from "../src/core/subprocess.js";
import { materializedTaskPacketSchema } from "../src/domain/task.js";

const mockedRunSubprocess = vi.mocked(runSubprocess);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("adapter default timeouts", () => {
  beforeEach(() => {
    mockedRunSubprocess.mockReset();
    mockedRunSubprocess.mockResolvedValue({
      durationMs: 1,
      exitCode: 0,
      signal: null,
      stderr: "",
      stderrTruncated: false,
      stdout: "",
      stdoutTruncated: false,
      timedOut: false,
    });
  });

  it("does not pass a default timeout to Claude adapter subprocesses", async () => {
    const root = await createTempRoot();
    const adapter = new ClaudeAdapter({ binaryPath: "claude" });

    await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir: join(root, "logs"),
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(mockedRunSubprocess).toHaveBeenCalledTimes(1);
    expect(mockedRunSubprocess.mock.calls[0]?.[0]).not.toHaveProperty("timeoutMs");
  });

  it("does not pass a default timeout to Codex adapter subprocesses", async () => {
    const root = await createTempRoot();
    const adapter = new CodexAdapter({ binaryPath: "codex" });

    await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir: join(root, "logs"),
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(mockedRunSubprocess).toHaveBeenCalledTimes(1);
    expect(mockedRunSubprocess.mock.calls[0]?.[0]).not.toHaveProperty("timeoutMs");
  });

  it("still forwards an explicit timeout override", async () => {
    const root = await createTempRoot();
    const adapter = new CodexAdapter({ binaryPath: "codex", timeoutMs: 300_000 });

    await adapter.recommendPreflight({
      runId: "run_1",
      projectRoot: root,
      logDir: join(root, "logs"),
      taskPacket: createTaskPacket(),
      signals: createRepoSignals(),
    });

    expect(mockedRunSubprocess).toHaveBeenCalledTimes(1);
    expect(mockedRunSubprocess.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 300_000 });
  });
});

function createTaskPacket() {
  return materializedTaskPacketSchema.parse({
    id: "fix-session-loss",
    title: "Fix session loss",
    intent: "Preserve login state during refresh.",
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [],
    source: {
      kind: "task-note",
      path: "/tmp/task.md",
    },
  });
}

function createRepoSignals() {
  return {
    packageManager: "npm" as const,
    scripts: ["lint", "test"],
    dependencies: ["typescript"],
    files: ["package.json", "README.md"],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: ["Task input is repo-local."],
    capabilities: [],
    provenance: [],
    skippedCommandCandidates: [],
    commandCatalog: [],
  };
}

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-adapter-timeouts-"));
  tempRoots.push(path);
  return path;
}
