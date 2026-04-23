import { type Command, InvalidArgumentError } from "commander";

import { OraculumError } from "../core/errors.js";
import type { Adapter } from "../domain/config.js";
import {
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
  uninstallHostWrapperShellBindings,
} from "../services/chat-native.js";
import { setupClaudeCodeHost, uninstallClaudeCodeHost } from "../services/claude-chat-native.js";
import { setupCodexHost, uninstallCodexHost } from "../services/codex-chat-native.js";

interface SetupOptions {
  runtime: Adapter;
}

interface SetupStatusOptions {
  json?: boolean;
  runtime?: Adapter;
}

interface UninstallOptions {
  runtime?: Adapter;
}

export function registerSetupCommand(program: Command): void {
  const setup = program
    .command("setup")
    .description("Register chat-native host integration.")
    .option("-r, --runtime <runtime>", "target host runtime", parseRuntime)
    .action(async (options: SetupOptions, command: Command) => {
      const runtime = options.runtime ?? (command.optsWithGlobals().runtime as Adapter | undefined);

      if (!runtime) {
        throw new OraculumError(
          'setup requires "--runtime <claude-code|codex>" unless a subcommand is used.',
        );
      }

      if (runtime === "claude-code") {
        const result = await setupClaudeCodeHost();

        process.stdout.write("Configured Claude Code chat-native integration.\n");
        process.stdout.write(`Packaged root: ${result.packagedRoot}\n`);
        process.stdout.write(`Plugin root: ${result.pluginRoot}\n`);
        process.stdout.write(`Marketplace: ${result.marketplacePath}\n`);
        process.stdout.write("Interactive path: use `orc ...` directly inside Claude Code.\n");
        return;
      }

      if (runtime === "codex") {
        const result = await setupCodexHost();

        process.stdout.write("Configured Codex chat-native integration.\n");
        process.stdout.write(`Packaged root: ${result.packagedRoot}\n`);
        process.stdout.write(`Install root: ${result.installRoot}\n`);
        process.stdout.write(`Skills root: ${result.skillsRoot}\n`);
        process.stdout.write(`Rules root: ${result.rulesRoot}\n`);
        process.stdout.write("Interactive path: use `orc ...` directly inside Codex.\n");
        return;
      }

      throw new OraculumError(`Chat-native setup for "${runtime}" is not implemented yet.`);
    });

  setup
    .command("status")
    .description("Inspect host setup diagnostics for chat-native routing.")
    .option("--json", "emit machine-readable setup diagnostics")
    .option("-r, --runtime <runtime>", "target host runtime", parseRuntime)
    .action(async (options: SetupStatusOptions, command: Command) => {
      const runtime = options.runtime ?? (command.optsWithGlobals().runtime as Adapter | undefined);
      const diagnostics = filterSetupDiagnosticsResponse(
        await buildSetupDiagnosticsResponse(process.cwd()),
        runtime,
      );

      if (options.json) {
        process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${diagnostics.summary}\n`);
      for (const host of diagnostics.hosts) {
        if (options.runtime && host.host !== options.runtime) {
          continue;
        }

        process.stdout.write(
          `${host.host}: status=${host.status} registered=${host.registered ? "yes" : "no"} artifacts=${host.artifactsInstalled ? "yes" : "no"} launch=${host.launchTransport}\n`,
        );
        process.stdout.write(`- next: ${host.nextAction}\n`);
        for (const note of host.notes) {
          process.stdout.write(`- ${note}\n`);
        }
      }
    });

  program
    .command("uninstall")
    .description("Remove Oraculum chat-native host integration and installed host artifacts.")
    .option("-r, --runtime <runtime>", "target host runtime", parseRuntime)
    .action(async (options: UninstallOptions) => {
      const runtimes: Adapter[] = options.runtime ? [options.runtime] : ["claude-code", "codex"];

      for (const runtime of runtimes) {
        if (runtime === "claude-code") {
          const result = await uninstallClaudeCodeHost();
          process.stdout.write("Removed Claude Code chat-native integration.\n");
          process.stdout.write(`Install root: ${result.installRoot}\n`);
          continue;
        }

        if (runtime === "codex") {
          const result = await uninstallCodexHost();
          process.stdout.write("Removed Codex chat-native integration.\n");
          process.stdout.write(`Install root: ${result.installRoot}\n`);
          process.stdout.write(`Skills root: ${result.skillsRoot}\n`);
          process.stdout.write(`Rules root: ${result.rulesRoot}\n`);
          continue;
        }

        throw new OraculumError(`Chat-native uninstall for "${runtime}" is not implemented yet.`);
      }

      if (!options.runtime) {
        await uninstallHostWrapperShellBindings();
        return;
      }

      const diagnostics = await buildSetupDiagnosticsResponse(process.cwd());
      const hasRemainingHostIntegration = diagnostics.hosts.some(
        (host) => host.registered || host.artifactsInstalled,
      );
      if (!hasRemainingHostIntegration) {
        await uninstallHostWrapperShellBindings();
      }
    });
}

function parseRuntime(value: string): Adapter {
  if (value !== "claude-code" && value !== "codex") {
    throw new InvalidArgumentError('runtime must be one of: "claude-code", "codex".');
  }

  return value;
}
