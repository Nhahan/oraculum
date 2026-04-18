import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { APP_VERSION } from "../../core/constants.js";
import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import {
  isClaudeMarketplaceAligned,
  isClaudePluginAligned,
  listClaudeMarketplaces,
  listClaudePlugins,
} from "./discovery.js";
import {
  getExpectedClaudeCommandFiles,
  getExpectedClaudeSkillDirs,
  getPackagedClaudeCodeRoot,
} from "./packaged.js";
import {
  CLAUDE_LEGACY_PLUGIN_NAMES,
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_MCP_TIMEOUT_SECONDS,
  CLAUDE_PLUGIN_NAME,
  CLAUDE_PLUGIN_VERSION,
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

  if (!existsSync(pluginRoot) || !existsSync(marketplacePath)) {
    throw new OraculumError(
      "Packaged Claude Code artifacts are missing. Build Oraculum first so setup can install the generated host artifacts.",
    );
  }

  await mkdir(join(homeDir, ".claude"), { recursive: true });
  const effectiveMcpConfig = buildClaudePluginMcpConfigFromInvocation(
    options.mcpInvocation ?? resolveNodeCliInvocation(),
  );
  await mergeClaudeMcpConfig(mcpConfigPath, effectiveMcpConfig);

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
  const targetPlugin = installedPlugins.find((entry) => targetPluginNames.includes(entry.name));
  if (targetPlugin?.name) {
    try {
      await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env, targetPlugin.name);
      pluginRemoved = true;
    } catch {
      pluginRemoved = false;
    }
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

async function mergeClaudeMcpConfig(
  mcpConfigPath: string,
  effectiveConfig: Record<string, unknown>,
): Promise<void> {
  const existing = existsSync(mcpConfigPath)
    ? (JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      })
    : {};
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
  await writeFile(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function removeClaudeMcpConfigEntry(mcpConfigPath: string): Promise<void> {
  if (!existsSync(mcpConfigPath)) {
    return;
  }

  const existing = JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
    mcpServers?: Record<string, unknown>;
  };
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
  await writeFile(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function pruneClaudePluginArtifacts(homeDir: string): Promise<void> {
  await pruneSelectedClaudePluginArtifacts(homeDir, [
    CLAUDE_PLUGIN_NAME,
    ...CLAUDE_LEGACY_PLUGIN_NAMES,
  ]);
}

async function pruneSelectedClaudePluginArtifacts(
  homeDir: string,
  pluginNames: readonly string[],
): Promise<void> {
  const pluginsDir = join(homeDir, ".claude", "plugins");
  await Promise.all(
    pluginNames.flatMap((pluginName) => [
      rm(join(pluginsDir, pluginName), { force: true, recursive: true }),
      rm(join(pluginsDir, `@${pluginName}`), { force: true, recursive: true }),
      rm(join(pluginsDir, "cache", CLAUDE_MARKETPLACE_NAME, pluginName), {
        force: true,
        recursive: true,
      }),
    ]),
  );
}

async function prepareClaudeSetupRoot(options: {
  homeDir: string;
  mcpInvocation: { args: string[]; command: string };
  packagedRoot: string;
}): Promise<string> {
  const installRoot = join(options.homeDir, ".oraculum", "chat-native", "claude-code", APP_VERSION);
  await rm(installRoot, { force: true, recursive: true });
  await cp(options.packagedRoot, installRoot, {
    force: true,
    recursive: true,
  });
  await writeFile(
    join(installRoot, ".claude-plugin", ".mcp.json"),
    `${JSON.stringify(buildClaudePluginMcpConfigFromInvocation(options.mcpInvocation), null, 2)}\n`,
    "utf8",
  );
  return installRoot;
}

function assertPackagedClaudeArtifacts(packagedRoot: string): void {
  const expectedPaths = [
    ...getExpectedClaudeCommandFiles().map((path) => join(packagedRoot, path)),
    join(packagedRoot, ".claude-plugin", "plugin.json"),
    join(packagedRoot, ".claude-plugin", "marketplace.json"),
    ...getExpectedClaudeSkillDirs().map((dirName) =>
      join(packagedRoot, ".claude-plugin", "skills", dirName, "SKILL.md"),
    ),
  ];

  const missing = expectedPaths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new OraculumError(
      [
        `Packaged Claude Code host artifacts for ${CLAUDE_PLUGIN_VERSION} are incomplete.`,
        "Build Oraculum first so setup can install the generated host artifacts.",
        ...missing.map((path) => `Missing: ${path}`),
      ].join("\n"),
    );
  }
}

function buildClaudePluginMcpConfigFromInvocation(invocation: {
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

function hasClaudePluginInstallArtifacts(entry: { installPath?: string } | undefined): boolean {
  const installPath = entry?.installPath;
  if (!installPath) {
    return true;
  }

  if (
    !existsSync(join(installPath, "plugin.json")) ||
    !existsSync(join(installPath, ".mcp.json"))
  ) {
    return false;
  }

  return getExpectedClaudeSkillDirs().every((dirName) =>
    existsSync(join(installPath, "skills", dirName, "SKILL.md")),
  );
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

async function addClaudeMarketplace(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
  installRoot: string,
): Promise<void> {
  const addMarketplace = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "marketplace", "add", installRoot],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (addMarketplace.exitCode !== 0) {
    throw new OraculumError(
      `Failed to register the Oraculum Claude marketplace: ${extractSubprocessError(addMarketplace)}`,
    );
  }
}

async function removeClaudeMarketplace(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const removeMarketplace = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "marketplace", "remove", CLAUDE_MARKETPLACE_NAME],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (removeMarketplace.exitCode !== 0) {
    throw new OraculumError(
      `Failed to remove the stale Oraculum Claude marketplace: ${extractSubprocessError(removeMarketplace)}`,
    );
  }
}

async function installClaudePlugin(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const install = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "install", `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_NAME}`],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (install.exitCode !== 0) {
    throw new OraculumError(
      `Failed to install the Oraculum Claude plugin: ${extractSubprocessError(install)}`,
    );
  }
}

async function uninstallClaudePlugin(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
  pluginName: string,
): Promise<void> {
  const uninstall = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "uninstall", pluginName],
    cwd: process.cwd(),
    env,
    timeoutMs: 30_000,
  });
  if (uninstall.exitCode !== 0) {
    throw new OraculumError(
      `Failed to replace the stale Oraculum Claude plugin: ${extractSubprocessError(uninstall)}`,
    );
  }
}
