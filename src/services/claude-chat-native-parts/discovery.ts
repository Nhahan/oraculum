import { runSubprocess } from "../../core/subprocess.js";
import {
  CLAUDE_PLUGIN_VERSION,
  type ClaudeMarketplaceEntry,
  type ClaudePluginEntry,
  normalizePortablePath,
  readOptionalBoolean,
  readOptionalString,
} from "./shared.js";

export async function listClaudePlugins(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<ClaudePluginEntry[]> {
  const result = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "list", "--json"],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    return [];
  }

  return normalizeClaudePluginEntries(result.stdout);
}

export async function listClaudeMarketplaces(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<ClaudeMarketplaceEntry[]> {
  const result = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "marketplace", "list", "--json"],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    return [];
  }

  return normalizeClaudeMarketplaceEntries(result.stdout);
}

export function normalizeClaudeMarketplaceEntries(stdout: string): ClaudeMarketplaceEntry[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("name" in entry) ||
        typeof (entry as { name?: unknown }).name !== "string"
      ) {
        return [];
      }

      const normalized: ClaudeMarketplaceEntry = {
        name: (entry as { name: string }).name,
      };
      const source = readOptionalString(entry, "source");
      const path = readOptionalString(entry, "path");
      const installLocation = readOptionalString(entry, "installLocation");

      if (source) {
        normalized.source = source;
      }
      if (path) {
        normalized.path = path;
      }
      if (installLocation) {
        normalized.installLocation = installLocation;
      }

      return [normalized];
    });
  } catch {
    return [];
  }
}

export function normalizeClaudePluginEntries(stdout: string): ClaudePluginEntry[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }

      const id = readOptionalString(entry, "id");
      const explicitName = readOptionalString(entry, "name");
      const name = explicitName ?? id?.split("@")[0];
      if (!name) {
        return [];
      }

      const normalized: ClaudePluginEntry = {
        name,
      };
      if (id) {
        normalized.id = id;
      }
      const version = readOptionalString(entry, "version");
      const scope = readOptionalString(entry, "scope");
      const installPath = readOptionalString(entry, "installPath");
      const enabled = readOptionalBoolean(entry, "enabled");

      if (version) {
        normalized.version = version;
      }
      if (scope) {
        normalized.scope = scope;
      }
      if (installPath) {
        normalized.installPath = installPath;
      }
      if (typeof enabled === "boolean") {
        normalized.enabled = enabled;
      }

      return [normalized];
    });
  } catch {
    return [];
  }
}

export function isClaudeMarketplaceAligned(
  entry: ClaudeMarketplaceEntry | undefined,
  installRoot: string,
): boolean {
  if (!entry) {
    return false;
  }

  const marketplacePath = entry.path ?? entry.installLocation;
  if (!marketplacePath) {
    return false;
  }

  if (entry.source && entry.source !== "directory") {
    return false;
  }

  return normalizePortablePath(marketplacePath) === normalizePortablePath(installRoot);
}

export function isClaudePluginAligned(entry: ClaudePluginEntry | undefined): boolean {
  if (!entry || entry.version !== CLAUDE_PLUGIN_VERSION) {
    return false;
  }

  if (!entry.installPath) {
    return true;
  }

  return normalizePortablePath(entry.installPath).endsWith(`/${CLAUDE_PLUGIN_VERSION}`);
}
