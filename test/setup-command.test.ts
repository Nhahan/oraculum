import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/chat-native.js", () => ({
  buildSetupDiagnosticsResponse: vi.fn(),
}));

import { buildProgram } from "../src/program.js";
import { buildSetupDiagnosticsResponse } from "../src/services/chat-native.js";
import { captureStdout } from "./helpers/stdout.js";

const mockedBuildSetupDiagnosticsResponse = vi.mocked(buildSetupDiagnosticsResponse);

describe("setup command", () => {
  beforeEach(() => {
    mockedBuildSetupDiagnosticsResponse.mockReset();
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
          nextAction: "Run `oraculum setup --runtime claude-code`.",
          notes: ["Expected MCP config path: /tmp/home/.claude/mcp.json"],
        },
        {
          host: "codex",
          status: "ready",
          registered: true,
          artifactsInstalled: true,
          nextAction: "Use `orc ...` directly in Codex.",
          notes: ["Expected MCP config path: /tmp/home/.codex/config.toml"],
        },
      ],
      summary: "Claude Code and Codex are ready for host-native `orc ...` commands.",
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
      targetPrefix: string;
    };

    expect(parsed.targetPrefix).toBe("orc");
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.hosts[0]).toMatchObject({
      host: "codex",
      status: "ready",
    });
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
