import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { writeTextFileAtomically } from "../project.js";
import {
  CLAUDE_LEGACY_PLUGIN_NAMES,
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_MCP_TIMEOUT_SECONDS,
} from "./shared.js";

export async function assertClaudeHomeConfigFilesReadable(mcpConfigPath: string): Promise<void> {
  await readClaudeJsonObjectFile(
    mcpConfigPath,
    `Claude MCP config is not valid JSON: ${mcpConfigPath}`,
  );
}

export async function mergeClaudeMcpConfig(
  mcpConfigPath: string,
  effectiveConfig: Record<string, unknown>,
): Promise<void> {
  const existing =
    (await readClaudeJsonObjectFile<{
      mcpServers?: Record<string, unknown>;
    }>(mcpConfigPath, `Claude MCP config is not valid JSON: ${mcpConfigPath}`)) ?? {};
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [CLAUDE_MCP_SERVER_NAME]: (effectiveConfig as { mcpServers: Record<string, unknown> })
        .mcpServers[CLAUDE_MCP_SERVER_NAME],
    },
  };
  for (const legacyServerName of CLAUDE_LEGACY_PLUGIN_NAMES) {
    delete (next.mcpServers as Record<string, unknown>)[legacyServerName];
  }
  await mkdir(dirname(mcpConfigPath), { recursive: true });
  await writeTextFileAtomically(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function removeClaudeMcpConfigEntry(mcpConfigPath: string): Promise<void> {
  if (!existsSync(mcpConfigPath)) {
    return;
  }

  const existing = await readClaudeJsonObjectFile<{
    mcpServers?: Record<string, unknown>;
  }>(mcpConfigPath);
  if (!existing) {
    return;
  }
  const nextServers = { ...(existing.mcpServers ?? {}) };
  for (const serverName of [CLAUDE_MCP_SERVER_NAME, ...CLAUDE_LEGACY_PLUGIN_NAMES]) {
    delete nextServers[serverName];
  }
  const next =
    Object.keys(nextServers).length > 0
      ? {
          ...existing,
          mcpServers: nextServers,
        }
      : Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "mcpServers"));
  await mkdir(dirname(mcpConfigPath), { recursive: true });
  await writeTextFileAtomically(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`);
}

export function buildClaudePluginMcpConfigFromInvocation(invocation: {
  args: string[];
  command: string;
}): Record<string, unknown> {
  return {
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        command: invocation.command,
        args: [...invocation.args, "mcp", "serve"],
        env: {
          ORACULUM_AGENT_RUNTIME: "claude-code",
          ORACULUM_LLM_BACKEND: "claude-code",
        },
        timeout: CLAUDE_MCP_TIMEOUT_SECONDS,
      },
    },
  };
}

async function readClaudeJsonObjectFile<T extends Record<string, unknown>>(
  path: string,
  errorMessage?: string,
): Promise<T | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object.");
    }
    return parsed as T;
  } catch {
    if (errorMessage) {
      throw new OraculumError(errorMessage);
    }
    return undefined;
  }
}
