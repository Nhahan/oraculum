import { APP_VERSION } from "../../core/constants.js";

export interface ClaudeSetupOptions {
  claudeArgs?: string[];
  claudeBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  mcpInvocation?: {
    args: string[];
    command: string;
  };
  packagedRoot?: string;
}

export interface ClaudeSetupResult {
  effectiveMcpConfigPath: string;
  installRoot: string;
  packagedRoot: string;
  pluginRoot: string;
  marketplacePath: string;
  mcpConfigPath: string;
  pluginInstalled: boolean;
}

export interface ClaudeUninstallOptions {
  claudeArgs?: string[];
  claudeBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface ClaudeUninstallResult {
  installRoot: string;
  marketplaceRemoved: boolean;
  mcpConfigPath: string;
  pluginRemoved: boolean;
}

export interface ClaudeMarketplaceEntry {
  installLocation?: string;
  name: string;
  path?: string;
  source?: string;
}

export interface ClaudePluginEntry {
  enabled?: boolean;
  id?: string;
  installPath?: string;
  name: string;
  scope?: string;
  version?: string;
}

export const CLAUDE_MARKETPLACE_NAME = "oraculum";
export const CLAUDE_PLUGIN_NAME = "orc";
export const CLAUDE_LEGACY_PLUGIN_NAMES = ["oraculum"] as const;
export const CLAUDE_MCP_SERVER_NAME = CLAUDE_PLUGIN_NAME;
export const CLAUDE_PLUGIN_VERSION = APP_VERSION;
export const CLAUDE_MCP_TIMEOUT_SECONDS = 1800;

export function normalizePortablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function readOptionalBoolean(entry: object, key: string): boolean | undefined {
  if (!(key in entry)) {
    return undefined;
  }

  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readOptionalString(entry: object, key: string): string | undefined {
  if (!(key in entry)) {
    return undefined;
  }

  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function extractSubprocessError(result: { stderr: string; stdout: string }): string {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    return stderr;
  }

  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    return stdout;
  }

  return "unknown error";
}
