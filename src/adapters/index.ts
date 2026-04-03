import type { Adapter } from "../domain/config.js";

import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import type { AgentAdapter } from "./types.js";

interface AdapterFactoryOptions {
  claudeBinaryPath?: string;
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function createAgentAdapter(
  adapter: Adapter,
  options: AdapterFactoryOptions = {},
): AgentAdapter {
  if (adapter === "claude-code") {
    return new ClaudeAdapter({
      ...(options.claudeBinaryPath ? { binaryPath: options.claudeBinaryPath } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  return new CodexAdapter({
    ...(options.codexBinaryPath ? { binaryPath: options.codexBinaryPath } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
}
