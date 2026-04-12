import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../core/constants.js";
import { OraculumError } from "../core/errors.js";
import { runSubprocess } from "../core/subprocess.js";
import type { CommandManifestEntry } from "../domain/chat-native.js";

interface ClaudeSetupOptions {
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

interface ClaudeSetupResult {
  effectiveMcpConfigPath: string;
  installRoot: string;
  packagedRoot: string;
  pluginRoot: string;
  marketplacePath: string;
  mcpConfigPath: string;
  pluginInstalled: boolean;
}

interface ClaudeUninstallOptions {
  claudeArgs?: string[];
  claudeBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

interface ClaudeUninstallResult {
  installRoot: string;
  marketplaceRemoved: boolean;
  mcpConfigPath: string;
  pluginRemoved: boolean;
}

interface ClaudeMarketplaceEntry {
  installLocation?: string;
  name: string;
  path?: string;
  source?: string;
}

interface ClaudePluginEntry {
  enabled?: boolean;
  id?: string;
  installPath?: string;
  name: string;
  scope?: string;
  version?: string;
}

const CLAUDE_MARKETPLACE_NAME = "oraculum";
const CLAUDE_PLUGIN_NAME = "oraculum";

export function getPackagedClaudeCodeRoot(): string {
  return fileURLToPath(new URL("../../dist/chat-native/claude-code", import.meta.url));
}

export function getPackagedClaudePluginRoot(): string {
  return join(getPackagedClaudeCodeRoot(), ".claude-plugin");
}

export function getPackagedClaudeMarketplacePath(): string {
  return join(getPackagedClaudePluginRoot(), "marketplace.json");
}

export function buildClaudeMarketplaceManifest(): Record<string, unknown> {
  return {
    name: CLAUDE_MARKETPLACE_NAME,
    owner: {
      name: "Nhahan",
      email: "kisy324@naver.com",
    },
    plugins: [
      {
        name: CLAUDE_PLUGIN_NAME,
        description: "Consult competing patches, read verdicts, and crown survivors with Oraculum.",
        version: APP_VERSION,
        author: {
          name: "Nhahan",
          email: "kisy324@naver.com",
        },
        source: "./.claude-plugin",
        category: "development",
        homepage: "https://github.com/Nhahan/oraculum",
        repository: "https://github.com/Nhahan/oraculum",
        license: "MIT",
        keywords: ["oraculum", "patch", "verdict", "crowning", "mcp"],
        tags: ["patch-consultation", "oracle-guided", "development"],
      },
    ],
  };
}

export function buildClaudePluginManifest(): Record<string, unknown> {
  return {
    name: CLAUDE_PLUGIN_NAME,
    version: APP_VERSION,
    description: "Oracle-guided patch consultation and crowning for Claude Code.",
    author: {
      name: "Nhahan",
      email: "kisy324@naver.com",
    },
    repository: "https://github.com/Nhahan/oraculum",
    homepage: "https://github.com/Nhahan/oraculum",
    license: "MIT",
    keywords: ["oraculum", "patch", "verdict", "crowning", "mcp"],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  };
}

export function buildClaudePluginMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      oraculum: {
        command: process.platform === "win32" ? "oraculum.cmd" : "oraculum",
        args: ["mcp", "serve"],
        env: {
          ORACULUM_AGENT_RUNTIME: "claude-code",
          ORACULUM_LLM_BACKEND: "claude-code",
        },
        timeout: 600,
      },
    },
  };
}

export function buildClaudeCommandFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  const claudePluginRootPlaceholder = "$" + "{CLAUDE_PLUGIN_ROOT}";

  return manifest
    .filter((entry) => entry.id !== "verdict-archive")
    .map((entry) => ({
      path: `commands/${entry.id}.md`,
      content: [
        "---",
        `description: "${entry.summary.replaceAll('"', '\\"')}"`,
        "---",
        "",
        "Read the file at `" +
          claudePluginRootPlaceholder +
          `/skills/${entry.id}/SKILL.md\` using the Read tool and follow its instructions exactly.`,
        "",
        "## User Input",
        "",
        "{{ARGUMENTS}}",
        "",
      ].join("\n"),
    }));
}

export function buildClaudeSkillFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return manifest
    .filter((entry) => new Set(["consult", "verdict", "crown", "draft", "init"]).has(entry.id))
    .map((entry) => ({
      path: `.claude-plugin/skills/${entry.id}/SKILL.md`,
      content: renderClaudeSkill(entry),
    }));
}

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
  const targetPlugin = installedPlugins.find((entry) => entry.name === CLAUDE_PLUGIN_NAME);
  if (!isClaudePluginAligned(targetPlugin)) {
    if (targetPlugin) {
      await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env);
    }
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

  const marketList = await listClaudeMarketplaces(claudeBinaryPath, claudeArgs, env);
  const installedMarketplace = marketList.find((entry) => entry.name === CLAUDE_MARKETPLACE_NAME);
  if (installedMarketplace) {
    await removeClaudeMarketplace(claudeBinaryPath, claudeArgs, env);
  }

  const installedPlugins = await listClaudePlugins(claudeBinaryPath, claudeArgs, env);
  const targetPlugin = installedPlugins.find((entry) => entry.name === CLAUDE_PLUGIN_NAME);
  if (targetPlugin) {
    await uninstallClaudePlugin(claudeBinaryPath, claudeArgs, env);
  }

  await removeClaudeMcpConfigEntry(mcpConfigPath);
  await rm(installRoot, { force: true, recursive: true });

  return {
    installRoot,
    marketplaceRemoved: installedMarketplace !== undefined,
    mcpConfigPath,
    pluginRemoved: targetPlugin !== undefined,
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
      oraculum: (effectiveConfig as { mcpServers: Record<string, unknown> }).mcpServers.oraculum,
    },
  };
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
  delete nextServers.oraculum;
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

async function prepareClaudeSetupRoot(options: {
  homeDir: string;
  mcpInvocation: { args: string[]; command: string };
  packagedRoot: string;
}): Promise<string> {
  const installRoot = join(options.homeDir, ".oraculum", "chat-native", "claude-code", APP_VERSION);
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

function buildClaudePluginMcpConfigFromInvocation(invocation: {
  args: string[];
  command: string;
}): Record<string, unknown> {
  return {
    mcpServers: {
      oraculum: {
        command: invocation.command,
        args: [...invocation.args, "mcp", "serve"],
        env: {
          ORACULUM_AGENT_RUNTIME: "claude-code",
          ORACULUM_LLM_BACKEND: "claude-code",
        },
        timeout: 600,
      },
    },
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

async function listClaudePlugins(
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

async function listClaudeMarketplaces(
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

function normalizeClaudeMarketplaceEntries(stdout: string): ClaudeMarketplaceEntry[] {
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

function normalizeClaudePluginEntries(stdout: string): ClaudePluginEntry[] {
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

function isClaudeMarketplaceAligned(
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

function isClaudePluginAligned(entry: ClaudePluginEntry | undefined): boolean {
  if (!entry || entry.version !== APP_VERSION) {
    return false;
  }

  if (!entry.installPath) {
    return true;
  }

  return normalizePortablePath(entry.installPath).endsWith(`/${APP_VERSION}`);
}

function normalizePortablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function readOptionalBoolean(entry: object, key: string): boolean | undefined {
  if (!(key in entry)) {
    return undefined;
  }

  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalString(entry: object, key: string): string | undefined {
  if (!(key in entry)) {
    return undefined;
  }

  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
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
): Promise<void> {
  const uninstall = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "uninstall", CLAUDE_PLUGIN_NAME],
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

function renderClaudeSkill(entry: CommandManifestEntry): string {
  const mcpArgs = buildClaudeSkillMcpArgs(entry);
  const magicPrefixes = entry.id === "crown" ? ["orc crown"] : [`orc ${entry.path.join(" ")}`];

  return [
    "---",
    `name: ${entry.id}`,
    `description: "${entry.summary.replaceAll('"', '\\"')}"`,
    `mcp_tool: ${entry.mcpTool}`,
    "mcp_args:",
    ...renderYamlObject(mcpArgs, 2),
    "magic_prefixes:",
    ...magicPrefixes.map((prefix) => `  - "${prefix}"`),
    "---",
    "",
    `# /oraculum:${entry.id}`,
    "",
    entry.summary,
    "",
    "## Usage",
    "",
    "```",
    ...buildUsageExamples(entry),
    "```",
    "",
    "## Notes",
    "",
    ...buildClaudeSkillNotes(entry),
    "",
  ].join("\n");
}

function buildClaudeSkillMcpArgs(entry: CommandManifestEntry): Record<string, unknown> {
  switch (entry.id) {
    case "consult":
    case "draft":
      return { cwd: "$CWD", taskInput: "$ARGUMENTS", agent: "claude-code" };
    case "verdict":
      return { cwd: "$CWD", consultationId: "$1" };
    case "crown":
      return { cwd: "$CWD", branchName: "$1", withReport: false };
    case "init":
      return { cwd: "$CWD", force: false };
    default:
      return { cwd: "$CWD" };
  }
}

function buildUsageExamples(entry: CommandManifestEntry): string[] {
  switch (entry.id) {
    case "crown":
      return ["orc crown fix/session-loss", "orc crown"];
    case "consult":
      return ['orc consult "fix session loss on refresh"'];
    case "draft":
      return ['orc draft "fix session loss on refresh"'];
    case "verdict":
      return ["orc verdict", "orc verdict run_20260404_xxxx"];
    case "init":
      return ["orc init"];
    default:
      return entry.examples;
  }
}

function buildClaudeSkillNotes(entry: CommandManifestEntry): string[] {
  if (entry.id === "crown") {
    return [
      "- The first argument is required only when crowning a Git-backed candidate onto a new branch.",
      "- In non-Git workspace-sync mode, `orc crown` may omit the first argument; if one is present, Oraculum records it as a materialization label rather than a Git branch.",
      "- It crowns the recommended survivor from the latest eligible consultation and materializes the patch.",
      "- After the MCP tool succeeds, report the verified materialization result and stop; do not re-apply the patch or run extra Bash, Edit, or Write steps unless the user explicitly asks.",
      "- The shared chat-native surface is `orc crown <branch-name>` for Git projects and `orc crown` for non-Git projects.",
      "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
    ];
  }

  return [
    "- This skill is intended for exact-prefix routing inside Claude Code.",
    "- After the MCP tool returns, relay Oraculum's result; do not replace the next Oraculum command with ad-hoc shell work.",
    "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
  ];
}

function renderYamlObject(value: Record<string, unknown>, indent: number): string[] {
  const prefix = " ".repeat(indent);
  return Object.entries(value).map(([key, entry]) => {
    if (typeof entry === "string") {
      return `${prefix}${key}: "${entry.replaceAll('"', '\\"')}"`;
    }

    return `${prefix}${key}: ${String(entry)}`;
  });
}

function extractSubprocessError(result: { stderr: string; stdout: string }): string {
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
