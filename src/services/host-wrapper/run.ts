import { OraculumError } from "../../core/errors.js";
import {
  parseOrcCommandLine,
  runClaudeOfficialTransport,
  runCodexOfficialTransport,
} from "../official-host-transport.js";
import { getHostWrapperAdapter } from "./adapters.js";
import { extractOrcCommandLine, stripForwardedWrapperSeparator } from "./decision.js";
import { getDirectTransport } from "./transport.js";
import type { HostWrapperRunOptions } from "./types.js";

export async function runHostWrapper(options: HostWrapperRunOptions): Promise<number> {
  const args = stripForwardedWrapperSeparator(options.args);
  const adapter = getHostWrapperAdapter(options.host);
  const hostBinary = resolveWrappedHostBinary(adapter.hostBinary, options.env ?? process.env);
  const orcCommandLine = extractOrcCommandLine(adapter.host, args);

  if (orcCommandLine) {
    const officialOptions = {
      command: hostBinary,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
    };
    try {
      const packet = parseOrcCommandLine(orcCommandLine, options.cwd ?? process.cwd());
      const summary = await runOfficialTransport(adapter.host, packet, {
        ...officialOptions,
      });
      process.stdout.write(`${summary}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(
        renderOfficialRouteFailure({
          commandLine: orcCommandLine,
          error,
          host: adapter.host,
        }),
      );
      return 1;
    }
  }

  return await getDirectTransport().run({
    ...options,
    args,
    command: hostBinary,
  });
}

function resolveWrappedHostBinary(defaultBinary: string, env: NodeJS.ProcessEnv): string {
  const explicit = env.ORACULUM_HOST_WRAPPER_REAL_BINARY?.trim();
  if (explicit) {
    return explicit;
  }

  return defaultBinary;
}

async function runOfficialTransport(
  host: HostWrapperRunOptions["host"],
  packet: ReturnType<typeof parseOrcCommandLine>,
  options: Parameters<typeof runCodexOfficialTransport>[1],
): Promise<string> {
  if (host === "codex") {
    const result = await runCodexOfficialTransport(packet, options);
    return renderOfficialTransportResult(result.toolResult);
  }

  if (host === "claude-code") {
    const result = await runClaudeOfficialTransport(packet, options);
    return renderOfficialTransportResult(result.toolResult);
  }

  throw new OraculumError(`Unsupported official host transport runtime: ${host satisfies never}`);
}

function renderOfficialRouteFailure(options: {
  commandLine: string;
  error: unknown;
  host: HostWrapperRunOptions["host"];
}): string {
  return [
    "Oraculum host-native route failed.",
    `Host: ${options.host}`,
    `Command: ${options.commandLine}`,
    `Reason: ${formatUnknownError(options.error)}`,
    "Run `oraculum setup status` in your terminal to inspect host registration.",
    "",
  ].join("\n");
}

function renderOfficialTransportResult(toolResult: unknown): string {
  if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
    const payload = toolResult as {
      content?: Array<{ text?: unknown }>;
      structuredContent?: { summary?: unknown };
      summary?: unknown;
    };

    if (typeof payload.summary === "string" && payload.summary.length > 0) {
      return payload.summary;
    }

    if (
      payload.structuredContent &&
      typeof payload.structuredContent.summary === "string" &&
      payload.structuredContent.summary.length > 0
    ) {
      return payload.structuredContent.summary;
    }

    const firstText = payload.content?.find(
      (entry): entry is { text: string } =>
        typeof entry?.text === "string" && entry.text.length > 0,
    );
    if (firstText) {
      return firstText.text;
    }
  }

  return JSON.stringify(toolResult, null, 2);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
