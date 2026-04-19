import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { APP_VERSION } from "../../core/constants.js";
import { getAdvancedConfigPath, getConfigPath, resolveProjectRoot } from "../../core/paths.js";
import type { SetupStatusToolResponse } from "../../domain/chat-native.js";
import { setupStatusToolResponseSchema } from "../../domain/chat-native.js";
import {
  getExpectedClaudeCommandFiles,
  getExpectedClaudeSkillDirs,
} from "../claude-chat-native.js";
import { getExpectedCodexRuleFileName, getExpectedCodexSkillDirs } from "../codex-chat-native.js";
import { getHostWrapperSnippetPath, resolveHostWrapperRcPath } from "../host-wrapper.js";

const MANAGED_CLAUDE_PLUGIN_KEYS = ["orc@oraculum", "oraculum@oraculum"] as const;
const MANAGED_CLAUDE_PLUGIN_DIRS = ["orc", "@orc", "oraculum", "@oraculum"] as const;
const MANAGED_MCP_SERVER_IDS = ["orc", "oraculum"] as const;

export function buildSetupDiagnosticsResponse(cwd: string): SetupStatusToolResponse {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);
  const claudeMcpPath = join(homedir(), ".claude", "mcp.json");
  const claudePluginsDir = join(homedir(), ".claude", "plugins");
  const claudeInstallRoot = join(homedir(), ".oraculum", "chat-native", "claude-code", APP_VERSION);
  const codexConfigPath = join(homedir(), ".codex", "config.toml");
  const codexSkillsDir = join(homedir(), ".codex", "skills");
  const codexRulesDir = join(homedir(), ".codex", "rules");
  const shellWrapperSnippetPath = getHostWrapperSnippetPath();
  const shellWrapperRcPath = resolveHostWrapperRcPath();
  const shellWrapperInstalled = hasShellWrapperBindings(
    shellWrapperSnippetPath,
    shellWrapperRcPath,
  );
  const projectInitialized = existsSync(configPath);
  const advancedConfigPresent = existsSync(advancedConfigPath);

  const claudeRegistered = MANAGED_MCP_SERVER_IDS.some((serverId) =>
    hasMcpServer(claudeMcpPath, serverId),
  );
  const claudeArtifactsInstalled = hasClaudePluginInstalled(claudeInstallRoot);
  const claudeLaunchTransport = computeLaunchTransportMode(
    "claude-code",
    claudeRegistered,
    claudeArtifactsInstalled,
    shellWrapperInstalled,
  );

  const codexRegistered = hasCodexMcpServer(codexConfigPath);
  const codexArtifactsInstalled = hasCodexArtifactsInstalled(codexSkillsDir, codexRulesDir);
  const codexLaunchTransport = computeLaunchTransportMode(
    "codex",
    codexRegistered,
    codexArtifactsInstalled,
    shellWrapperInstalled,
  );

  const hosts = [
    buildHostDiagnostics({
      artifactsInstalled: claudeArtifactsInstalled,
      host: "claude-code",
      launchTransport: claudeLaunchTransport,
      notes: [
        `Expected MCP config path: ${toPortableDisplayPath(claudeMcpPath)}`,
        `Expected Claude plugin cache root: ${toPortableDisplayPath(claudePluginsDir)}`,
        `Expected Claude install root: ${toPortableDisplayPath(claudeInstallRoot)}`,
        "Stable/default path: launch-time exact `orc ...` via the official Claude stream-json route.",
        "Run `oraculum setup --runtime claude-code` to register the MCP server and install the Oraculum plugin.",
      ],
      registered: claudeRegistered,
    }),
    buildHostDiagnostics({
      artifactsInstalled: codexArtifactsInstalled,
      host: "codex",
      launchTransport: codexLaunchTransport,
      notes: [
        `Expected MCP config path: ${toPortableDisplayPath(codexConfigPath)}`,
        `Expected skill install root: ${toPortableDisplayPath(codexSkillsDir)}`,
        `Expected rule install root: ${toPortableDisplayPath(codexRulesDir)}`,
        "Stable/default path: launch-time exact `orc ...` via the official Codex app-server route.",
        "Run `oraculum setup --runtime codex` to register the MCP server and install the Oraculum skills and rules.",
      ],
      registered: codexRegistered,
    }),
  ];

  return setupStatusToolResponseSchema.parse({
    mode: "setup-status",
    cwd: projectRoot,
    projectInitialized,
    ...(projectInitialized ? { configPath } : {}),
    ...(advancedConfigPresent ? { advancedConfigPath } : {}),
    targetPrefix: "orc",
    hosts,
    summary: summarizeSetupDiagnosticsHosts(hosts),
  });
}

export function filterSetupDiagnosticsResponse(
  diagnostics: SetupStatusToolResponse,
  host?: SetupStatusToolResponse["hosts"][number]["host"],
): SetupStatusToolResponse {
  const hosts = host ? diagnostics.hosts.filter((entry) => entry.host === host) : diagnostics.hosts;

  return setupStatusToolResponseSchema.parse({
    ...diagnostics,
    hosts,
    summary: summarizeSetupDiagnosticsHosts(hosts),
  });
}

export function summarizeSetupDiagnosticsHosts(
  hosts: Array<{
    artifactsInstalled: boolean;
    host: SetupStatusToolResponse["hosts"][number]["host"];
    launchTransport: SetupStatusToolResponse["hosts"][number]["launchTransport"];
    registered: boolean;
    status: SetupStatusToolResponse["hosts"][number]["status"];
  }>,
): string {
  if (hosts.length === 0) {
    return "No matching host runtime was found.";
  }

  if (hosts.length === 1) {
    const [host] = hosts;
    if (!host) {
      return "No matching host runtime was found.";
    }

    return host.status === "ready"
      ? `${host.host} is ready for launch-time exact \`orc ...\` commands.`
      : `Run \`oraculum setup --runtime ${host.host}\` to finish launch-time \`orc ...\` routing, then use \`oraculum setup status --runtime ${host.host}\` to verify the wiring.`;
  }

  return hosts.every((host) => host.status === "ready")
    ? "Claude Code and Codex are ready for launch-time exact `orc ...` commands."
    : "Run `oraculum setup --runtime <host>` to finish launch-time `orc ...` routing, then use `oraculum setup status` to verify the wiring.";
}

export function hasClaudePluginArtifactsInstalled(pluginsDir: string): boolean {
  if (!existsSync(pluginsDir)) {
    return false;
  }

  if (
    MANAGED_CLAUDE_PLUGIN_DIRS.some((dirName) =>
      hasCurrentClaudePluginDir(join(pluginsDir, dirName)),
    )
  ) {
    return true;
  }

  const installedPluginsPath = join(pluginsDir, "installed_plugins.json");
  if (!existsSync(installedPluginsPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(installedPluginsPath, "utf8")) as {
      plugins?: Record<string, Array<{ installPath?: unknown; version?: unknown }>>;
    };
    return MANAGED_CLAUDE_PLUGIN_KEYS.some((pluginKey) => {
      const installed = parsed.plugins?.[pluginKey];
      if (!Array.isArray(installed)) {
        return false;
      }

      return installed.some(
        (entry) =>
          entry.version === APP_VERSION &&
          typeof entry.installPath === "string" &&
          hasCurrentClaudePluginArtifacts(join(entry.installPath)),
      );
    });
  } catch {
    return false;
  }
}

export function hasClaudeCommandArtifactsInstalled(installRoot: string): boolean {
  return getExpectedClaudeCommandFiles().every((path) => existsSync(join(installRoot, path)));
}

export function hasCodexArtifactsInstalled(skillsDir: string, rulesDir: string): boolean {
  if (!existsSync(skillsDir) || !existsSync(rulesDir)) {
    return false;
  }

  const expectedRule = join(rulesDir, getExpectedCodexRuleFileName());
  if (!existsSync(expectedRule)) {
    return false;
  }

  return getExpectedCodexSkillDirs().every((dirName) =>
    existsSync(join(skillsDir, dirName, "SKILL.md")),
  );
}

function buildHostDiagnostics(options: {
  artifactsInstalled: boolean;
  host: SetupStatusToolResponse["hosts"][number]["host"];
  launchTransport: SetupStatusToolResponse["hosts"][number]["launchTransport"];
  notes: string[];
  registered: boolean;
}): SetupStatusToolResponse["hosts"][number] {
  const status = computeHostSetupStatus(
    options.registered,
    options.artifactsInstalled,
    options.launchTransport,
  );

  return {
    host: options.host,
    status,
    registered: options.registered,
    artifactsInstalled: options.artifactsInstalled,
    launchTransport: options.launchTransport,
    nextAction:
      status === "ready"
        ? `Use launch-time exact \`orc ...\` with ${options.host === "claude-code" ? "Claude Code" : "Codex"}.`
        : `Run \`oraculum setup --runtime ${options.host}\`.`,
    notes: options.notes,
  };
}

function computeHostSetupStatus(
  registered: boolean,
  artifactsInstalled: boolean,
  launchTransport: SetupStatusToolResponse["hosts"][number]["launchTransport"],
): "ready" | "partial" | "needs-setup" {
  if (registered && artifactsInstalled && launchTransport === "official") {
    return "ready";
  }

  if (!registered && !artifactsInstalled) {
    return "needs-setup";
  }

  return "partial";
}

function computeLaunchTransportMode(
  host: SetupStatusToolResponse["hosts"][number]["host"],
  registered: boolean,
  artifactsInstalled: boolean,
  shellWrapperInstalled: boolean,
): SetupStatusToolResponse["hosts"][number]["launchTransport"] {
  if (!registered || !artifactsInstalled) {
    return "unavailable";
  }

  return shellWrapperInstalled && hasCommandOnPath(host === "codex" ? "codex" : "claude")
    ? "official"
    : "unavailable";
}

function hasCurrentClaudePluginDir(path: string): boolean {
  return hasCurrentClaudePluginArtifacts(path);
}

function hasCurrentClaudePluginArtifacts(path: string): boolean {
  const pluginJsonPath = join(path, "plugin.json");
  const mcpConfigPath = join(path, ".mcp.json");
  if (!existsSync(pluginJsonPath) || !existsSync(mcpConfigPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as {
      version?: unknown;
    };
    if (parsed.version !== APP_VERSION) {
      return false;
    }

    return getExpectedClaudeSkillDirs().every((dirName) =>
      existsSync(join(path, "skills", dirName, "SKILL.md")),
    );
  } catch {
    return false;
  }
}

function hasMcpServer(path: string, serverId: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(parsed.mcpServers?.[serverId]);
  } catch {
    return false;
  }
}

function hasClaudePluginInstalled(installRoot: string): boolean {
  return (
    hasClaudePluginArtifactsInstalled(join(homedir(), ".claude", "plugins")) &&
    hasClaudeCommandArtifactsInstalled(installRoot)
  );
}

function hasCodexMcpServer(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return MANAGED_MCP_SERVER_IDS.some((serverId) =>
      new RegExp(`\\[mcp_servers\\.${serverId}\\]`, "u").test(raw),
    );
  } catch {
    return false;
  }
}

function hasShellWrapperBindings(snippetPath: string, rcPath?: string): boolean {
  if (!existsSync(snippetPath)) {
    return false;
  }

  if (!rcPath || !existsSync(rcPath)) {
    return false;
  }

  try {
    return readFileSync(rcPath, "utf8").includes(snippetPath);
  } catch {
    return false;
  }
}

function hasCommandOnPath(command: string): boolean {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter((entry) => entry.length > 0)
      : [""];

  return pathValue
    .split(delimiter)
    .some((segment) =>
      extensions.some((extension) => existsSync(join(segment, `${command}${extension}`))),
    );
}

function toPortableDisplayPath(path: string): string {
  return path.replaceAll("\\", "/");
}
