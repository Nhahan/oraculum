import { describe, expect, it } from "vitest";

import {
  buildClaudeOfficialTransportPrompt,
  buildClaudeStreamJsonUserMessage,
  buildCodexInitializeRequest,
  buildCodexMcpToolCallRequest,
  buildCodexThreadStartRequest,
  detectClaudeStreamJsonCapability,
  parseOrcCommandArgv,
  parseOrcCommandLine,
  tokenizeOrcCommandLine,
} from "../src/services/chat-native.js";

describe("official host transport packet parsing", () => {
  it("tokenizes quoted unicode input", () => {
    expect(tokenizeOrcCommandLine('orc consult "안녕 세상" --agent codex')).toEqual([
      "orc",
      "consult",
      "안녕 세상",
      "--agent",
      "codex",
    ]);
  });

  it("parses consult commands into a validated request packet", () => {
    const packet = parseOrcCommandLine(
      'orc consult "안녕" --agent codex --candidates 2 --timeout-ms 3000',
      "/tmp/project",
    );

    expect(packet.entry.id).toBe("consult");
    expect(packet.toolId).toBe("oraculum_consult");
    expect(packet.request).toEqual({
      cwd: "/tmp/project",
      taskInput: "안녕",
      agent: "codex",
      candidates: 2,
      timeoutMs: 3000,
    });
  });

  it("parses verdict archive and init commands", () => {
    expect(
      parseOrcCommandArgv(["orc", "verdict", "archive", "20"], "/tmp/project").request,
    ).toEqual({
      cwd: "/tmp/project",
      count: 20,
    });
    expect(parseOrcCommandArgv(["orc", "init", "--force"], "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      force: true,
    });
  });

  it("rejects unknown commands and unknown options", () => {
    expect(() => parseOrcCommandLine("orc missing", "/tmp/project")).toThrow("Unknown orc command");
    expect(() => parseOrcCommandLine('orc consult "안녕" --nope', "/tmp/project")).toThrow(
      "Unknown option",
    );
  });
});

describe("official host transport request builders", () => {
  const packet = parseOrcCommandLine('orc consult "안녕"', "/tmp/project");

  it("builds Codex app-server requests", () => {
    expect(buildCodexInitializeRequest("init")).toEqual({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: {
        clientInfo: {
          name: "oraculum",
          version: "0.1.0-beta.8",
        },
        capabilities: null,
      },
    });

    expect(buildCodexThreadStartRequest("thread", "/tmp/project")).toEqual({
      jsonrpc: "2.0",
      id: "thread",
      method: "thread/start",
      params: { cwd: "/tmp/project" },
    });

    expect(buildCodexMcpToolCallRequest("tool", "thread-1", packet)).toEqual({
      jsonrpc: "2.0",
      id: "tool",
      method: "mcpServer/tool/call",
      params: {
        threadId: "thread-1",
        server: "orc",
        tool: "oraculum_consult",
        arguments: {
          cwd: "/tmp/project",
          taskInput: "안녕",
        },
      },
    });
  });

  it("builds Claude stream-json request content", () => {
    const prompt = buildClaudeOfficialTransportPrompt(packet);
    expect(prompt).toContain("oraculum_consult");
    expect(prompt).toContain('"taskInput": "안녕"');

    expect(buildClaudeStreamJsonUserMessage(packet)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    });
  });

  it("detects Claude stream-json support from help text", () => {
    const capability = detectClaudeStreamJsonCapability(
      "Options: --input-format ... --output-format ... stream-json",
    );
    expect(capability).toEqual({
      available: true,
      detail: "Requires --print --input-format stream-json --output-format stream-json.",
      host: "claude-code",
    });
  });
});
