import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import { writeTextFileAtomically } from "../project.js";
import {
  CODEX_LEGACY_MCP_SERVER_NAMES,
  CODEX_MCP_SERVER_NAME,
  CODEX_MCP_STARTUP_TIMEOUT_SEC,
  CODEX_MCP_TOOL_TIMEOUT_SEC,
  extractSubprocessError,
} from "./shared.js";

export async function registerCodexMcpServer(options: {
  codexArgs: string[];
  codexBinaryPath: string;
  env: NodeJS.ProcessEnv;
  mcpInvocation: {
    args: string[];
    command: string;
  };
}): Promise<void> {
  for (const serverName of [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES]) {
    await runSubprocess({
      command: options.codexBinaryPath,
      args: [...options.codexArgs, "mcp", "remove", serverName],
      cwd: process.cwd(),
      env: options.env,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  }

  const addResult = await runSubprocess({
    command: options.codexBinaryPath,
    args: [
      ...options.codexArgs,
      "mcp",
      "add",
      CODEX_MCP_SERVER_NAME,
      "--env",
      "ORACULUM_AGENT_RUNTIME=codex",
      "--env",
      "ORACULUM_LLM_BACKEND=codex",
      "--",
      options.mcpInvocation.command,
      ...options.mcpInvocation.args,
      "mcp",
      "serve",
    ],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  });
  if (addResult.exitCode !== 0) {
    throw new OraculumError(
      `Failed to register the Oraculum Codex MCP server: ${extractSubprocessError(addResult)}`,
    );
  }

  const verifyResult = await runSubprocess({
    command: options.codexBinaryPath,
    args: [...options.codexArgs, "mcp", "get", CODEX_MCP_SERVER_NAME, "--json"],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  });
  if (verifyResult.exitCode !== 0) {
    throw new OraculumError(
      `Failed to verify the Oraculum Codex MCP server: ${extractSubprocessError(verifyResult)}`,
    );
  }

  await upsertCodexMcpTimeouts(join(options.env.HOME ?? homedir(), ".codex", "config.toml"));
}

export async function unregisterCodexMcpServer(options: {
  codexArgs: string[];
  codexBinaryPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  for (const serverName of [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES]) {
    await runSubprocess({
      command: options.codexBinaryPath,
      args: [...options.codexArgs, "mcp", "remove", serverName],
      cwd: process.cwd(),
      env: options.env,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  }
}

export async function removeCodexMcpConfigEntry(configPath: string): Promise<void> {
  try {
    const raw = await readFile(configPath, "utf8");
    const next = [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES].reduce(
      (content, serverName) => stripCodexMcpServerSection(content, `mcp_servers.${serverName}`),
      raw,
    );
    if (next !== raw) {
      await writeTextFileAtomically(configPath, next);
    }
  } catch {
    // Leave best-effort uninstall cleanup to the managed artifacts when the config is absent
    // or unreadable.
  }
}

function stripCodexMcpServerSection(content: string, sectionPrefix: string): string {
  const lines = content.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = /^\[(.+)\]$/u.exec(trimmed);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      if (!sectionName) {
        skipping = false;
        kept.push(line);
        continue;
      }
      skipping = sectionName === sectionPrefix || sectionName.startsWith(`${sectionPrefix}.`);
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") {
    kept.pop();
  }

  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

async function upsertCodexMcpTimeouts(configPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/u);
  const output: string[] = [];
  let inTargetSection = false;
  let insertedStartup = false;
  let insertedTool = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = /^\[(.+)\]$/u.exec(trimmed);
    if (sectionMatch) {
      if (inTargetSection) {
        if (!insertedStartup) {
          output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
        }
        if (!insertedTool) {
          output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
        }
      }
      inTargetSection = sectionMatch[1] === `mcp_servers.${CODEX_MCP_SERVER_NAME}`;
      insertedStartup = false;
      insertedTool = false;
      output.push(line);
      continue;
    }

    if (inTargetSection && trimmed.startsWith("startup_timeout_sec")) {
      output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
      insertedStartup = true;
      continue;
    }
    if (inTargetSection && trimmed.startsWith("tool_timeout_sec")) {
      output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
      insertedTool = true;
      continue;
    }

    output.push(line);
  }

  if (inTargetSection) {
    if (!insertedStartup) {
      output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
    }
    if (!insertedTool) {
      output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
    }
  }

  const normalized = `${output.join("\n").replace(/\n+$/u, "")}\n`;
  if (normalized !== raw) {
    await writeTextFileAtomically(configPath, normalized);
  }
}
