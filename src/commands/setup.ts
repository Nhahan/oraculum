import { type Command, InvalidArgumentError } from "commander";

import { OraculumError } from "../core/errors.js";
import type { Adapter } from "../domain/config.js";
import { buildSetupDiagnosticsResponse } from "../services/chat-native.js";
import { type ClaudeSetupScope, setupClaudeCodeHost } from "../services/claude-chat-native.js";

interface SetupOptions {
  runtime: Adapter;
  scope: ClaudeSetupScope;
}

interface SetupStatusOptions {
  runtime?: Adapter;
}

export function registerSetupCommand(program: Command): void {
  const setup = program
    .command("setup")
    .description("Register chat-native host integration and MCP wiring.")
    .requiredOption("-r, --runtime <runtime>", "target host runtime", parseRuntime)
    .option("--scope <scope>", "installation scope: user, project, or local", parseScope, "user")
    .action(async (options: SetupOptions) => {
      if (options.runtime !== "claude-code") {
        throw new OraculumError(
          `Chat-native setup for "${options.runtime}" is not implemented yet. Claude Code lands first; Codex follows next.`,
        );
      }

      const result = await setupClaudeCodeHost({
        scope: options.scope,
      });

      process.stdout.write("Configured Claude Code chat-native integration.\n");
      process.stdout.write(`Scope: ${result.scope}\n`);
      process.stdout.write(`Packaged root: ${result.packagedRoot}\n`);
      process.stdout.write(`Plugin root: ${result.pluginRoot}\n`);
      process.stdout.write(`Marketplace: ${result.marketplacePath}\n`);
      process.stdout.write(`MCP config: ${result.mcpConfigPath}\n`);
    });

  setup
    .command("status")
    .description("Inspect host setup diagnostics for chat-native routing.")
    .option("-r, --runtime <runtime>", "target host runtime", parseRuntime)
    .action(async (options: SetupStatusOptions) => {
      const diagnostics = await buildSetupDiagnosticsResponse(process.cwd());
      process.stdout.write(`${diagnostics.summary}\n`);
      for (const host of diagnostics.hosts) {
        if (options.runtime && host.host !== options.runtime) {
          continue;
        }

        process.stdout.write(
          `${host.host}: registered=${host.registered ? "yes" : "no"} artifacts=${host.artifactsInstalled ? "yes" : "no"}\n`,
        );
        for (const note of host.notes) {
          process.stdout.write(`- ${note}\n`);
        }
      }
    });
}

function parseRuntime(value: string): Adapter {
  if (value !== "claude-code" && value !== "codex") {
    throw new InvalidArgumentError('runtime must be one of: "claude-code", "codex".');
  }

  return value;
}

function parseScope(value: string): ClaudeSetupScope {
  if (value !== "user" && value !== "project" && value !== "local") {
    throw new InvalidArgumentError('scope must be one of: "user", "project", "local".');
  }

  return value;
}
