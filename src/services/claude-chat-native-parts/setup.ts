import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import {
  resolveDirectCliInvocation,
  rewriteDirectRouteInvocation,
} from "../chat-native/direct-route.js";
import {
  isClaudeMarketplaceAligned,
  listClaudeMarketplaces,
  listClaudePlugins,
} from "./discovery.js";
import { getPackagedClaudeCodeRoot } from "./packaged.js";
import {
  addClaudeMarketplace,
  installClaudePlugin,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
} from "./plugin-commands.js";
import {
  assertPackagedClaudeArtifacts,
  prepareClaudeSetupRoot,
  pruneClaudePluginArtifacts,
  pruneSelectedClaudePluginArtifacts,
} from "./setup-artifacts.js";
import {
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
    packagedRoot,
  });
  const pluginRoot = join(installRoot, ".claude-plugin");
  const marketplacePath = join(pluginRoot, "marketplace.json");

  await rewriteDirectRouteInvocation({
    invocation: options.directCliInvocation ?? resolveDirectCliInvocation(),
    root: installRoot,
  });

  if (!existsSync(pluginRoot) || !existsSync(marketplacePath)) {
    throw new OraculumError(
      "Packaged Claude Code artifacts are missing. Build Oraculum first so setup can install the generated host artifacts.",
    );
  }

  await mkdir(join(homeDir, ".claude"), { recursive: true });

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
  const targetPlugin = installedPlugins.find((entry) => entry.name === CLAUDE_PLUGIN_NAME);
  if (targetPlugin) {
    await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, CLAUDE_PLUGIN_NAME);
  }
  await pruneSelectedClaudePluginArtifacts(homeDir, [CLAUDE_PLUGIN_NAME]);
  await installClaudePlugin(claudeBinaryPath, claudeArgs, env);

  return {
    installRoot,
    packagedRoot,
    pluginRoot,
    marketplacePath,
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
  const targetPlugin = installedPlugins.find((entry) => entry.name === CLAUDE_PLUGIN_NAME);
  if (targetPlugin?.name) {
    try {
      await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, targetPlugin.name);
      pluginRemoved = true;
    } catch {
      pluginRemoved = false;
    }
  }

  await pruneClaudePluginArtifacts(homeDir);
  await rm(installRoot, { force: true, recursive: true });

  return {
    installRoot,
    marketplaceRemoved,
    pluginRemoved,
  };
}
