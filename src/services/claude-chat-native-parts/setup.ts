import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import {
  isClaudeMarketplaceAligned,
  isClaudePluginAligned,
  listClaudeMarketplaces,
  listClaudePlugins,
} from "./discovery.js";
import {
  assertClaudeHomeConfigFilesReadable,
  buildClaudePluginMcpConfigFromInvocation,
  mergeClaudeMcpConfig,
  removeClaudeMcpConfigEntry,
} from "./mcp-config.js";
import { getPackagedClaudeCodeRoot } from "./packaged.js";
import {
  addClaudeMarketplace,
  installClaudePlugin,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
} from "./plugin-commands.js";
import {
  assertPackagedClaudeArtifacts,
  hasClaudePluginInstallArtifacts,
  prepareClaudeSetupRoot,
  pruneClaudePluginArtifacts,
  pruneSelectedClaudePluginArtifacts,
} from "./setup-artifacts.js";
import {
  CLAUDE_LEGACY_PLUGIN_NAMES,
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_NAME,
  type ClaudeSetupOptions,
  type ClaudeSetupResult,
  type ClaudeUninstallOptions,
  type ClaudeUninstallResult,
  extractSubprocessError,
} from "./shared.js";

export async function setupClaudeCodeHost(
  options: ClaudeSetupOptions = {},
): Promise<ClaudeSetupResult> {
  const homeDir = options.homeDir ?? homedir();
  const claudeBinaryPath = options.claudeBinaryPath ?? "claude";
  const claudeArgs = options.claudeArgs ?? [];
  const env = {
    ...process.env,
    ...options.env,
    HOME: homeDir,
  };

  const packagedRoot = options.packagedRoot ?? getPackagedClaudeCodeRoot();
  assertPackagedClaudeArtifacts(packagedRoot);
  const installRoot = await prepareClaudeSetupRoot({
    homeDir,
    mcpInvocation: options.mcpInvocation ?? resolveNodeCliInvocation(),
    packagedRoot,
  });
  const pluginRoot = join(installRoot, ".claude-plugin");
  const marketplacePath = join(pluginRoot, "marketplace.json");
  const mcpConfigPath = join(homeDir, ".claude", "mcp.json");

  await assertClaudeHomeConfigFilesReadable(mcpConfigPath);

  if (!existsSync(pluginRoot) || !existsSync(marketplacePath)) {
    throw new OraculumError(
      "Packaged Claude Code artifacts are missing. Build Oraculum first so setup can install the generated host artifacts.",
    );
  }

  await mkdir(join(homeDir, ".claude"), { recursive: true });
  const effectiveMcpConfig = buildClaudePluginMcpConfigFromInvocation(
    options.mcpInvocation ?? resolveNodeCliInvocation(),
  );

  const validate = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "validate", installRoot],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (validate.exitCode !== 0) {
    throw new OraculumError(`Claude plugin validation failed: ${extractSubprocessError(validate)}`);
  }

  const marketList = await listClaudeMarketplaces(claudeBinaryPath, claudeArgs, env);
  const installedMarketplace = marketList.find((entry) => entry.name === CLAUDE_MARKETPLACE_NAME);
  if (!isClaudeMarketplaceAligned(installedMarketplace, installRoot)) {
    if (installedMarketplace) {
      await removeClaudeMarketplace(claudeBinaryPath, claudeArgs, env);
    }
    await addClaudeMarketplace(claudeBinaryPath, claudeArgs, env, installRoot);
  }

  const installedPlugins = await listClaudePlugins(claudeBinaryPath, claudeArgs, env);
  for (const legacyName of CLAUDE_LEGACY_PLUGIN_NAMES) {
    const legacyPlugin = installedPlugins.find((entry) => entry.name === legacyName);
    if (legacyPlugin) {
      await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, legacyName);
    }
  }
  await pruneSelectedClaudePluginArtifacts(homeDir, CLAUDE_LEGACY_PLUGIN_NAMES);
  const targetPlugin = installedPlugins.find((entry) => entry.name === CLAUDE_PLUGIN_NAME);
  if (!isClaudePluginAligned(targetPlugin) || !hasClaudePluginInstallArtifacts(targetPlugin)) {
    if (targetPlugin) {
      await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, CLAUDE_PLUGIN_NAME);
    }
    await pruneSelectedClaudePluginArtifacts(homeDir, [CLAUDE_PLUGIN_NAME]);
    await installClaudePlugin(claudeBinaryPath, claudeArgs, env);
  }

  await mergeClaudeMcpConfig(mcpConfigPath, effectiveMcpConfig);

  return {
    effectiveMcpConfigPath: join(pluginRoot, ".mcp.json"),
    installRoot,
    packagedRoot,
    pluginRoot,
    marketplacePath,
    mcpConfigPath,
    pluginInstalled: true,
  };
}

export async function uninstallClaudeCodeHost(
  options: ClaudeUninstallOptions = {},
): Promise<ClaudeUninstallResult> {
  const homeDir = options.homeDir ?? homedir();
  const claudeBinaryPath = options.claudeBinaryPath ?? "claude";
  const claudeArgs = options.claudeArgs ?? [];
  const env = {
    ...process.env,
    ...options.env,
    HOME: homeDir,
  };
  const installRoot = join(homeDir, ".oraculum", "chat-native", "claude-code");
  const mcpConfigPath = join(homeDir, ".claude", "mcp.json");

  let marketplaceRemoved = false;
  const marketList = await listClaudeMarketplaces(claudeBinaryPath, claudeArgs, env).catch(
    () => [],
  );
  const installedMarketplace = marketList.find((entry) => entry.name === CLAUDE_MARKETPLACE_NAME);
  if (installedMarketplace) {
    try {
      await removeClaudeMarketplace(claudeBinaryPath, claudeArgs, env);
      marketplaceRemoved = true;
    } catch {
      marketplaceRemoved = false;
    }
  }

  let pluginRemoved = false;
  const installedPlugins = await listClaudePlugins(claudeBinaryPath, claudeArgs, env).catch(
    () => [],
  );
  const targetPluginNames = [CLAUDE_PLUGIN_NAME, ...CLAUDE_LEGACY_PLUGIN_NAMES];
  const targetPlugins = installedPlugins.filter((entry) => targetPluginNames.includes(entry.name));
  if (targetPlugins.length > 0) {
    let removedCount = 0;
    for (const targetPlugin of targetPlugins) {
      if (!targetPlugin.name) {
        continue;
      }
      try {
        await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, targetPlugin.name);
        removedCount += 1;
      } catch {
        // Best-effort uninstall should continue pruning the remaining Oraculum plugin variants.
      }
    }
    pluginRemoved = removedCount > 0;
  }

  await removeClaudeMcpConfigEntry(mcpConfigPath);
  await pruneClaudePluginArtifacts(homeDir);
  await rm(installRoot, { force: true, recursive: true });

  return {
    installRoot,
    marketplaceRemoved,
    mcpConfigPath,
    pluginRemoved,
  };
}

function resolveNodeCliInvocation(): { args: string[]; command: string } {
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    throw new OraculumError("Cannot determine the current Oraculum CLI entry for Claude setup.");
  }

  return {
    command: process.execPath,
    args: [cliEntry],
  };
}
