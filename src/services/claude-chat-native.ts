import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../core/constants.js";
import { OraculumError } from "../core/errors.js";
import { runSubprocess } from "../core/subprocess.js";
import type { CommandManifestEntry } from "../domain/chat-native.js";

export type ChatNativeSetupScope = "user" | "project" | "local";
export type ClaudeSetupScope = ChatNativeSetupScope;

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
  scope: ClaudeSetupScope;
}

interface ClaudeSetupResult {
  effectiveMcpConfigPath: string;
  installRoot: string;
  scope: ClaudeSetupScope;
  packagedRoot: string;
  pluginRoot: string;
  marketplacePath: string;
  mcpConfigPath: string;
  pluginInstalled: boolean;
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

export async function setupClaudeCodeHost(options: ClaudeSetupOptions): Promise<ClaudeSetupResult> {
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
  if (!marketList.some((entry) => entry.name === CLAUDE_MARKETPLACE_NAME)) {
    const addMarketplace = await runSubprocess({
      command: claudeBinaryPath,
      args: [...claudeArgs, "plugin", "marketplace", "add", installRoot, "--scope", options.scope],
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

  const installedPlugins = await listClaudePlugins(claudeBinaryPath, claudeArgs, env);
  if (!installedPlugins.some((entry) => entry.name === CLAUDE_PLUGIN_NAME)) {
    const install = await runSubprocess({
      command: claudeBinaryPath,
      args: [
        ...claudeArgs,
        "plugin",
        "install",
        `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_NAME}`,
        "--scope",
        options.scope,
      ],
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

  return {
    effectiveMcpConfigPath: join(pluginRoot, ".mcp.json"),
    installRoot,
    scope: options.scope,
    packagedRoot,
    pluginRoot,
    marketplacePath,
    mcpConfigPath,
    pluginInstalled: true,
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
): Promise<Array<{ name: string }>> {
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

  return normalizeNamedEntries(result.stdout);
}

async function listClaudeMarketplaces(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<Array<{ name: string }>> {
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

  return normalizeNamedEntries(result.stdout);
}

function normalizeNamedEntries(stdout: string): Array<{ name: string }> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (entry): entry is { name: string } =>
          typeof entry === "object" &&
          entry !== null &&
          "name" in entry &&
          typeof (entry as { name?: unknown }).name === "string",
      )
      .map((entry) => ({ name: entry.name }));
  } catch {
    return [];
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
      return { cwd: "$CWD", taskInput: "$1" };
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
      return ["orc crown fix/session-loss"];
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
      "- The chat-native crowning path expects the branch name as the first argument.",
      "- It crowns the recommended survivor from the latest eligible consultation.",
      "- The shared chat-native surface is `orc crown <branch-name>`.",
      "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
    ];
  }

  return [
    "- This skill is intended for exact-prefix routing inside Claude Code.",
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
