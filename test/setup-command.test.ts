import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/chat-native.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/chat-native.js")>();
  return {
    ...actual,
    buildSetupDiagnosticsResponse: vi.fn(),
    installHostWrapperShellBindings: vi.fn(),
  };
});

vi.mock("../src/services/codex-chat-native.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/codex-chat-native.js")>(
    "../src/services/codex-chat-native.js",
  );
  return {
    ...actual,
    setupCodexHost: vi.fn(),
  };
});

vi.mock("../src/services/claude-chat-native.js", async () => {
  const actual = await vi.importActual<typeof import("../src/services/claude-chat-native.js")>(
    "../src/services/claude-chat-native.js",
  );
  return {
    ...actual,
    setupClaudeCodeHost: vi.fn(),
  };
});

import { buildProgram } from "../src/program.js";
import {
  buildSetupDiagnosticsResponse,
  installHostWrapperShellBindings,
} from "../src/services/chat-native.js";
import { setupClaudeCodeHost } from "../src/services/claude-chat-native.js";
import { setupCodexHost } from "../src/services/codex-chat-native.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedBuildSetupDiagnosticsResponse = vi.mocked(buildSetupDiagnosticsResponse);
const mockedInstallHostWrapperShellBindings = vi.mocked(installHostWrapperShellBindings);
const mockedSetupCodexHost = vi.mocked(setupCodexHost);
const mockedSetupClaudeCodeHost = vi.mocked(setupClaudeCodeHost);

describe("setup command", () => {
  beforeEach(() => {
    mockedBuildSetupDiagnosticsResponse.mockReset();
    mockedInstallHostWrapperShellBindings.mockReset();
    mockedSetupCodexHost.mockReset();
    mockedSetupClaudeCodeHost.mockReset();
    mockedInstallHostWrapperShellBindings.mockResolvedValue({
      rcPath: "/tmp/home/.zshrc",
      snippetPath: "/tmp/home/.oraculum/chat-native/shell/oraculum-host-wrapper.zsh",
    });
    mockedSetupCodexHost.mockResolvedValue({
      configPath: "/tmp/home/.codex/config.toml",
      installRoot: "/tmp/home/.oraculum/chat-native/codex",
      packagedRoot: "/tmp/repo/dist/chat-native/codex",
      registered: true,
      rulesRoot: "/tmp/home/.codex/rules",
      skillsRoot: "/tmp/home/.codex/skills",
    });
    mockedSetupClaudeCodeHost.mockResolvedValue({
      effectiveMcpConfigPath:
        "/tmp/home/.oraculum/chat-native/claude-code/.claude-plugin/.mcp.json",
      installRoot: "/tmp/home/.oraculum/chat-native/claude-code",
      marketplacePath:
        "/tmp/home/.oraculum/chat-native/claude-code/.claude-plugin/marketplace.json",
      mcpConfigPath: "/tmp/home/.claude/mcp.json",
      packagedRoot: "/tmp/repo/dist/chat-native/claude-code",
      pluginInstalled: true,
      pluginRoot: "/tmp/home/.oraculum/chat-native/claude-code/.claude-plugin",
    });
    mockedBuildSetupDiagnosticsResponse.mockResolvedValue({
      mode: "setup-status",
      cwd: process.cwd(),
      projectInitialized: true,
      configPath: "/tmp/project/.oraculum/config.json",
      advancedConfigPath: "/tmp/project/.oraculum/advanced.json",
      targetPrefix: "orc",
      hosts: [
        {
          host: "claude-code",
          status: "needs-setup",
          registered: false,
          artifactsInstalled: false,
          launchTransport: "unavailable",
          nextAction: "Run `oraculum setup --runtime claude-code`.",
          notes: ["Expected MCP config path: /tmp/home/.claude/mcp.json"],
        },
        {
          host: "codex",
          status: "ready",
          registered: true,
          artifactsInstalled: true,
          launchTransport: "official",
          nextAction: "Use launch-time exact `orc ...` with Codex.",
          notes: ["Expected MCP config path: /tmp/home/.codex/config.toml"],
        },
      ],
      summary: "Claude Code and Codex are ready for launch-time exact `orc ...` commands.",
    });
  });

  it("prints machine-readable setup diagnostics as json", async () => {
    const program = createProgram();

    const output = await captureStdout(async () => {
      await program.parseAsync(["setup", "status", "--json", "--runtime", "codex"], {
        from: "user",
      });
    });

    const parsed = JSON.parse(output) as {
      hosts: Array<{ host: string; status: string }>;
      summary: string;
      targetPrefix: string;
    };

    expect(parsed.targetPrefix).toBe("orc");
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.hosts[0]).toMatchObject({
      host: "codex",
      status: "ready",
    });
    expect(parsed.summary).toBe("codex is ready for launch-time exact `orc ...` commands.");
  });

  it("prints launch-only plain-text status summaries", async () => {
    const program = createProgram();

    const output = await captureStdout(async () => {
      await program.parseAsync(["setup", "status", "--runtime", "claude-code"], {
        from: "user",
      });
    });

    expect(output).toContain(
      "Run `oraculum setup --runtime claude-code` to finish launch-time `orc ...` routing, then use `oraculum setup status --runtime claude-code` to verify the wiring.",
    );
    expect(output).toContain(
      "claude-code: status=needs-setup registered=no artifacts=no launch=unavailable",
    );
  });

  it("prints Codex stable launch-time guidance during setup", async () => {
    const program = createProgram();

    const output = await captureStdout(async () => {
      await program.parseAsync(["setup", "--runtime", "codex"], {
        from: "user",
      });
    });

    expect(output).toContain("Codex stable/default path: launch-time official transport");
    expect(output).not.toContain("experimental");
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
