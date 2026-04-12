import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/claude-chat-native.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/claude-chat-native.js")>(
    "../src/services/claude-chat-native.js",
  );
  return {
    ...actual,
    uninstallClaudeCodeHost: vi.fn(),
  };
});

vi.mock("../src/services/codex-chat-native.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/codex-chat-native.js")>(
    "../src/services/codex-chat-native.js",
  );
  return {
    ...actual,
    uninstallCodexHost: vi.fn(),
  };
});

import { buildProgram } from "../src/program.js";
import { uninstallClaudeCodeHost } from "../src/services/claude-chat-native.js";
import { uninstallCodexHost } from "../src/services/codex-chat-native.js";

const mockedUninstallClaudeCodeHost = vi.mocked(uninstallClaudeCodeHost);
const mockedUninstallCodexHost = vi.mocked(uninstallCodexHost);

describe("uninstall command", () => {
  beforeEach(() => {
    mockedUninstallClaudeCodeHost.mockReset();
    mockedUninstallCodexHost.mockReset();
    mockedUninstallClaudeCodeHost.mockResolvedValue({
      installRoot: "/tmp/home/.oraculum/chat-native/claude-code",
      marketplaceRemoved: true,
      mcpConfigPath: "/tmp/home/.claude/mcp.json",
      pluginRemoved: true,
    });
    mockedUninstallCodexHost.mockResolvedValue({
      configPath: "/tmp/home/.codex/config.toml",
      installRoot: "/tmp/home/.oraculum/chat-native/codex",
      registered: false,
      rulesRoot: "/tmp/home/.codex/rules",
      skillsRoot: "/tmp/home/.codex/skills",
    });
  });

  it("removes both host integrations when no runtime is specified", async () => {
    const program = createProgram();

    await expect(program.parseAsync(["uninstall"], { from: "user" })).resolves.toBeTruthy();

    expect(mockedUninstallClaudeCodeHost).toHaveBeenCalledTimes(1);
    expect(mockedUninstallCodexHost).toHaveBeenCalledTimes(1);
  });

  it("removes only the requested runtime when --runtime is provided", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["uninstall", "--runtime", "codex"], { from: "user" }),
    ).resolves.toBeTruthy();

    expect(mockedUninstallClaudeCodeHost).not.toHaveBeenCalled();
    expect(mockedUninstallCodexHost).toHaveBeenCalledTimes(1);
  });
});

function createProgram() {
  const program = buildProgram();
  configureCommandTree(program);
  return program;
}

function configureCommandTree(program: Command) {
  program.exitOverride();
  program.configureOutput({
    writeErr() {},
    writeOut() {},
  });
  for (const command of program.commands) {
    configureCommandTree(command);
  }
}
