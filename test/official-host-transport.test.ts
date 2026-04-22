import { access } from "node:fs/promises";
import { join } from "node:path";

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
  runClaudeOfficialTransport,
  runCodexOfficialTransport,
  tokenizeOrcCommandLine,
} from "../src/services/chat-native.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";
import { writeNodeBinary } from "./helpers/fake-binary.js";

registerChatNativeTempRootCleanup();

describe("official host transport packet parsing", () => {
  it("tokenizes quoted unicode input", () => {
    expect(tokenizeOrcCommandLine('orc consult "안녕 세상"')).toEqual([
      "orc",
      "consult",
      "안녕 세상",
    ]);
  });

  it("parses consult commands into a validated request packet", () => {
    const packet = parseOrcCommandLine('orc consult "안녕"', "/tmp/project");

    expect(packet.entry.id).toBe("consult");
    expect(packet.toolId).toBe("oraculum_consult");
    expect(packet.request).toEqual({
      cwd: "/tmp/project",
      taskInput: "안녕",
    });
  });

  it("parses variadic task input for planning commands", () => {
    expect(parseOrcCommandLine("orc consult fix login bug", "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      taskInput: "fix login bug",
    });
    expect(parseOrcCommandLine("orc plan 로그인 버그 수정", "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      taskInput: "로그인 버그 수정",
    });
    expect(parseOrcCommandLine('orc draft "fix login bug"', "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      taskInput: "fix login bug",
    });
    expect(
      parseOrcCommandLine('orc plan "remove the old --agent and --answer docs"', "/tmp/project")
        .request,
    ).toEqual({
      cwd: "/tmp/project",
      taskInput: "remove the old --agent and --answer docs",
    });
  });

  it("rejects removed planning flags with task/config guidance", () => {
    expect(() =>
      parseOrcCommandLine("orc consult fix login bug --agent codex", "/tmp/project"),
    ).toThrow("accept task text only");
    expect(() =>
      parseOrcCommandLine('orc plan "add auth" --answer "email only"', "/tmp/project"),
    ).toThrow("Include the clarification answer directly in the task text");
    expect(() =>
      parseOrcCommandLine('orc draft "fix login bug" --candidates 3', "/tmp/project"),
    ).toThrow("accept task text only");
    expect(() =>
      parseOrcCommandLine('orc plan --deliberate "risky auth migration"', "/tmp/project"),
    ).toThrow("accept task text only");
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
    expect(() => parseOrcCommandLine("orc verdict run_1 extra", "/tmp/project")).toThrow(
      "Unexpected extra argument",
    );
  });

  it("parses crown unsafe override", () => {
    expect(
      parseOrcCommandLine("orc crown fix/session-loss --allow-unsafe", "/tmp/project").request,
    ).toEqual({
      cwd: "/tmp/project",
      materializationName: "fix/session-loss",
      withReport: false,
      allowUnsafe: true,
    });
    expect(parseOrcCommandLine("orc crown --allow-unsafe=false", "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      withReport: false,
      allowUnsafe: false,
    });
    expect(parseOrcCommandLine("orc crown --allow-unsafe false", "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      withReport: false,
      allowUnsafe: false,
    });
    expect(parseOrcCommandLine("orc crown --allow-unsafe true", "/tmp/project").request).toEqual({
      cwd: "/tmp/project",
      withReport: false,
      allowUnsafe: true,
    });
    expect(() => parseOrcCommandLine("orc crown --allow-unsafe=", "/tmp/project")).toThrow(
      "Expected boolean",
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

describe("Codex official host transport failure handling", () => {
  it("completes a JSON-RPC tool call through the app-server protocol", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-codex-transport-success-");
    const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
    const fakeCodex = await writeNodeBinary(
      projectRoot,
      "fake-codex-app-server-success",
      [
        "const readline = require('node:readline');",
        "const rl = readline.createInterface({ input: process.stdin });",
        "const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\\n');",
        "rl.on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (message.method === 'initialize') {",
        "    send({ id: message.id, result: { protocolVersion: '2025-03-26' } });",
        "    return;",
        "  }",
        "  if (message.method === 'thread/start') {",
        "    send({ id: message.id, result: { thread: { id: 'thread-fake' } } });",
        "    send({ method: 'mcpServer/startupStatus/updated', params: { name: 'orc', status: 'ready' } });",
        "    return;",
        "  }",
        "  if (message.method === 'mcpServer/tool/call') {",
        "    send({ id: message.id, result: { structuredContent: { summary: 'fake summary' } } });",
        "  }",
        "});",
      ].join("\n"),
    );

    const result = await runCodexOfficialTransport(packet, {
      command: fakeCodex,
      commandArgs: [],
      cwd: projectRoot,
      startupTimeoutMs: 250,
      transportTimeoutMs: 1_000,
    });

    expect(result.threadId).toBe("thread-fake");
    expect(result.startupEvents).toContainEqual({ name: "orc", status: "ready" });
    expect(result.toolResult).toEqual({ structuredContent: { summary: "fake summary" } });
  });

  it("rejects when the app-server exits while a JSON-RPC request is pending", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-codex-transport-failure-");
    const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
    const fakeCodex = await writeNodeBinary(
      projectRoot,
      "fake-codex-app-server",
      [
        "process.stdin.once('data', () => {",
        "  process.exit(7);",
        "});",
        "process.stdin.resume();",
      ].join("\n"),
    );

    await expect(
      rejectIfHung(
        runCodexOfficialTransport(packet, {
          command: fakeCodex,
          commandArgs: [],
          cwd: projectRoot,
          startupTimeoutMs: 250,
        }),
      ),
    ).rejects.toThrow("Codex app-server exited with code 7");
  });

  it("rejects when an app-server JSON-RPC request exceeds the transport timeout", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-codex-transport-timeout-");
    const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
    const fakeCodex = await writeNodeBinary(
      projectRoot,
      "fake-codex-app-server-hang",
      "process.stdin.resume(); setInterval(() => {}, 1000);",
    );

    await expect(
      rejectIfHung(
        runCodexOfficialTransport(packet, {
          command: fakeCodex,
          commandArgs: [],
          cwd: projectRoot,
          startupTimeoutMs: 250,
          transportTimeoutMs: 250,
        }),
      ),
    ).rejects.toThrow("Timed out waiting for Codex app-server request initialize");
  });

  it.skipIf(process.platform === "win32")(
    "terminates the app-server process group when a request times out",
    async () => {
      const projectRoot = await createChatNativeTempRoot("oraculum-codex-transport-tree-");
      const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
      const markerPath = join(projectRoot, "grandchild-marker.txt");
      const grandchildScript = [
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'alive', 'utf8'), 800);`,
        "setInterval(() => {}, 1000);",
      ].join("");
      const fakeCodex = await writeNodeBinary(
        projectRoot,
        "fake-codex-app-server-tree",
        [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore' }).unref();`,
          "process.stdin.resume();",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );

      await expect(
        runCodexOfficialTransport(packet, {
          command: fakeCodex,
          commandArgs: [],
          cwd: projectRoot,
          startupTimeoutMs: 250,
          transportTimeoutMs: 100,
        }),
      ).rejects.toThrow("Timed out waiting for Codex app-server request initialize");

      await delay(1_000);
      await expect(access(markerPath)).rejects.toThrow();
    },
  );
});

describe("Claude official host transport failure handling", () => {
  it("rejects when stream-json execution exceeds the transport timeout", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-claude-transport-timeout-");
    const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
    const fakeClaude = await writeNodeBinary(
      projectRoot,
      "fake-claude-stream-json-hang",
      "process.stdin.resume(); setInterval(() => {}, 1000);",
    );

    await expect(
      rejectIfHung(
        runClaudeOfficialTransport(packet, {
          command: fakeClaude,
          commandArgs: [],
          cwd: projectRoot,
          transportTimeoutMs: 250,
        }),
      ),
    ).rejects.toThrow("Claude official transport timed out");
  });

  it.skipIf(process.platform === "win32")(
    "terminates the stream-json process group when execution times out",
    async () => {
      const projectRoot = await createChatNativeTempRoot("oraculum-claude-transport-tree-");
      const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);
      const markerPath = join(projectRoot, "grandchild-marker.txt");
      const grandchildScript = [
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'alive', 'utf8'), 800);`,
        "setInterval(() => {}, 1000);",
      ].join("");
      const fakeClaude = await writeNodeBinary(
        projectRoot,
        "fake-claude-stream-json-tree",
        [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore' }).unref();`,
          "process.stdin.resume();",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );

      await expect(
        runClaudeOfficialTransport(packet, {
          command: fakeClaude,
          commandArgs: [],
          cwd: projectRoot,
          transportTimeoutMs: 100,
        }),
      ).rejects.toThrow("Claude official transport timed out");

      await delay(1_000);
      await expect(access(markerPath)).rejects.toThrow();
    },
  );
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectIfHung<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Codex app-server transport hung."));
      }, 5_000).unref();
    }),
  ]);
}
