import { afterEach, describe, expect, it, vi } from "vitest";

const mockDirectTransport = {
  id: "direct",
  run: vi.fn(async () => 17),
};

vi.mock("../src/services/official-host-transport.js", () => ({
  parseOrcCommandLine: vi.fn(() => ({
    argv: ['orc consult "안녕"'],
    commandLine: 'orc consult "안녕"',
    cwd: "/tmp/project",
    entry: { id: "consult", path: ["consult"], mcpTool: "oraculum_consult" },
    request: { cwd: "/tmp/project", taskInput: "안녕" },
    toolId: "oraculum_consult",
  })),
  runClaudeOfficialTransport: vi.fn(async () => ({
    streamEvents: [],
    toolResult: { summary: "claude summary" },
  })),
  runCodexOfficialTransport: vi.fn(async () => ({
    startupEvents: [],
    threadId: "thread-1",
    toolResult: { structuredContent: { summary: "codex summary" } },
  })),
}));

vi.mock("../src/services/host-wrapper/transport.js", () => ({
  getDirectTransport: vi.fn(() => mockDirectTransport),
  getPreferredInteractiveTransports: vi.fn(() => []),
}));

import { getDirectTransport, runHostWrapper } from "../src/services/host-wrapper.js";
import {
  parseOrcCommandLine,
  runClaudeOfficialTransport,
  runCodexOfficialTransport,
} from "../src/services/official-host-transport.js";

describe("host wrapper official route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockDirectTransport.run.mockClear();
  });

  it("routes launch-time codex orc prompts through the official transport first", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runHostWrapper({
      host: "codex",
      args: ['orc consult "안녕"'],
      cwd: "/tmp/project",
    });

    expect(code).toBe(0);
    expect(parseOrcCommandLine).toHaveBeenCalledWith('orc consult "안녕"', "/tmp/project");
    expect(runCodexOfficialTransport).toHaveBeenCalledTimes(1);
    expect(runClaudeOfficialTransport).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith("codex summary\n");
  });

  it("routes launch-time claude orc prompts through the official transport first", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runHostWrapper({
      host: "claude-code",
      args: ["-p", 'orc consult "안녕"'],
      cwd: "/tmp/project",
    });

    expect(code).toBe(0);
    expect(runClaudeOfficialTransport).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("claude summary\n");
  });

  it("fails closed with setup guidance when official transport fails", async () => {
    vi.mocked(runCodexOfficialTransport).mockRejectedValueOnce(new Error("boom"));
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await runHostWrapper({
      host: "codex",
      args: ['orc consult "안녕"'],
      cwd: "/tmp/project",
    });

    expect(code).toBe(1);
    expect(getDirectTransport).not.toHaveBeenCalled();
    expect(mockDirectTransport.run).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Host: codex"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Command: orc consult "안녕"'));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Reason: boom"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("oraculum setup status"));
  });

  it("keeps non-orc prompts on the direct host path", async () => {
    const code = await runHostWrapper({
      host: "codex",
      args: ["review", "hello"],
      cwd: "/tmp/project",
    });

    expect(code).toBe(17);
    expect(getDirectTransport).toHaveBeenCalledTimes(1);
    expect(mockDirectTransport.run).toHaveBeenCalledTimes(1);
  });
});
