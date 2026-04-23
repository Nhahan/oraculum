import { APP_VERSION } from "../../core/constants.js";
import type { DirectCliInvocation } from "../chat-native/direct-route.js";

export interface ClaudeSetupOptions {
  claudeArgs?: string[];
  claudeBinaryPath?: string;
  directCliInvocation?: DirectCliInvocation;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packagedRoot?: string;
}

export interface ClaudeSetupResult {
  installRoot: string;
  packagedRoot: string;
  pluginRoot: string;
  marketplacePath: string;
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
export const CLAUDE_PLUGIN_VERSION = APP_VERSION;

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
