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

vi.mock("../src/services/chat-native.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/chat-native.js")>(
    "../src/services/chat-native.js",
  );
  return {
    ...actual,
    buildSetupDiagnosticsResponse: vi.fn(),
    uninstallHostWrapperShellBindings: vi.fn(),
  };
});

import { buildProgram } from "../src/program.js";
import {
  buildSetupDiagnosticsResponse,
  uninstallHostWrapperShellBindings,
} from "../src/services/chat-native.js";
import { uninstallClaudeCodeHost } from "../src/services/claude-chat-native.js";
import { uninstallCodexHost } from "../src/services/codex-chat-native.js";

const mockedBuildSetupDiagnosticsResponse = vi.mocked(buildSetupDiagnosticsResponse);
const mockedUninstallHostWrapperShellBindings = vi.mocked(uninstallHostWrapperShellBindings);
const mockedUninstallClaudeCodeHost = vi.mocked(uninstallClaudeCodeHost);
const mockedUninstallCodexHost = vi.mocked(uninstallCodexHost);

describe("uninstall command", () => {
  beforeEach(() => {
    mockedBuildSetupDiagnosticsResponse.mockReset();
    mockedUninstallHostWrapperShellBindings.mockReset();
    mockedUninstallHostWrapperShellBindings.mockResolvedValue(undefined);
    mockedUninstallClaudeCodeHost.mockReset();
    mockedUninstallCodexHost.mockReset();
    mockedBuildSetupDiagnosticsResponse.mockResolvedValue({
      mode: "setup-status",
      cwd: process.cwd(),
      projectInitialized: true,
      configPath: "/tmp/project/.oraculum/config.json",
      targetPrefix: "orc",
      hosts: [
        {
          host: "claude-code",
          status: "ready",
          registered: true,
          artifactsInstalled: true,
          launchTransport: "official",
          nextAction: "Use `orc ...` directly in Claude Code.",
          notes: [],
        },
        {
          host: "codex",
          status: "needs-setup",
          registered: false,
          artifactsInstalled: false,
          launchTransport: "unavailable",
          nextAction: "Run `oraculum setup --runtime codex`.",
          notes: [],
        },
      ],
      summary: "Claude Code and Codex are ready for `orc ...` commands.",
    });
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
    expect(mockedUninstallHostWrapperShellBindings).toHaveBeenCalledTimes(1);
  });

  it("removes only the requested runtime when --runtime is provided", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["uninstall", "--runtime", "codex"], { from: "user" }),
    ).resolves.toBeTruthy();

    expect(mockedUninstallClaudeCodeHost).not.toHaveBeenCalled();
    expect(mockedUninstallCodexHost).toHaveBeenCalledTimes(1);
    expect(mockedUninstallHostWrapperShellBindings).not.toHaveBeenCalled();
  });

  it("removes the shell wrapper after scoped uninstall when no host integrations remain", async () => {
    mockedBuildSetupDiagnosticsResponse.mockResolvedValueOnce({
      mode: "setup-status",
      cwd: process.cwd(),
      projectInitialized: true,
      configPath: "/tmp/project/.oraculum/config.json",
      targetPrefix: "orc",
      hosts: [
        {
          host: "claude-code",
          status: "needs-setup",
          registered: false,
          artifactsInstalled: false,
          launchTransport: "unavailable",
          nextAction: "Run `oraculum setup --runtime claude-code`.",
          notes: [],
        },
        {
          host: "codex",
          status: "needs-setup",
          registered: false,
          artifactsInstalled: false,
          launchTransport: "unavailable",
          nextAction: "Run `oraculum setup --runtime codex`.",
          notes: [],
        },
      ],
      summary:
        "Run `oraculum setup --runtime <host>` to finish `orc ...` routing, then use `oraculum setup status` to verify the wiring.",
    });

    const program = createProgram();

    await expect(
      program.parseAsync(["uninstall", "--runtime", "codex"], { from: "user" }),
    ).resolves.toBeTruthy();

    expect(mockedUninstallHostWrapperShellBindings).toHaveBeenCalledTimes(1);
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
