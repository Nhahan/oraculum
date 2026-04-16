import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/subprocess.js", () => ({
  runSubprocess: vi.fn(),
}));

import { ClaudeAdapter } from "../src/adapters/claude.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { runSubprocess } from "../src/core/subprocess.js";
import { createRepoSignals, createTaskPacket } from "./helpers/adapters.js";
import { createTempRootHarness } from "./helpers/fs.js";

const mockedRunSubprocess = vi.mocked(runSubprocess);
const tempRootHarness = createTempRootHarness("oraculum-adapter-timeouts-");

tempRootHarness.registerCleanup();

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
async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
