import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { APP_VERSION } from "../../core/constants.js";
import { getAdvancedConfigPath, getConfigPath, resolveProjectRoot } from "../../core/paths.js";
import type { SetupStatusToolResponse } from "../../domain/chat-native.js";
import { setupStatusToolResponseSchema } from "../../domain/chat-native.js";
import { getExpectedCodexRuleFileName, getExpectedCodexSkillDirs } from "../codex-chat-native.js";

export function buildSetupDiagnosticsResponse(cwd: string): SetupStatusToolResponse {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);
  const claudeMcpPath = join(homedir(), ".claude", "mcp.json");
  const claudePluginsDir = join(homedir(), ".claude", "plugins");
  const codexConfigPath = join(homedir(), ".codex", "config.toml");
  const codexSkillsDir = join(homedir(), ".codex", "skills");
  const codexRulesDir = join(homedir(), ".codex", "rules");
  const claudeRegistered = hasMcpServer(claudeMcpPath, "oraculum");
  const claudeArtifactsInstalled = hasClaudePluginInstalled();
  const codexRegistered = hasCodexMcpServer(codexConfigPath);
  const codexArtifactsInstalled = hasCodexArtifactsInstalled(codexSkillsDir, codexRulesDir);
  const projectInitialized = existsSync(configPath);
  const advancedConfigPresent = existsSync(advancedConfigPath);

  const hosts = [
    buildHostDiagnostics({
      artifactsInstalled: claudeArtifactsInstalled,
      host: "claude-code",
      registered: claudeRegistered,
      notes: [
        `Expected MCP config path: ${toPortableDisplayPath(claudeMcpPath)}`,
        `Expected Claude plugin cache root: ${toPortableDisplayPath(claudePluginsDir)}`,
        "Run `oraculum setup --runtime claude-code` to register the MCP server and install the Oraculum plugin.",
      ],
    }),
    buildHostDiagnostics({
      artifactsInstalled: codexArtifactsInstalled,
      host: "codex",
      registered: codexRegistered,
      notes: [
        `Expected MCP config path: ${toPortableDisplayPath(codexConfigPath)}`,
        `Expected skill install root: ${toPortableDisplayPath(codexSkillsDir)}`,
        `Expected rule install root: ${toPortableDisplayPath(codexRulesDir)}`,
        "Run `oraculum setup --runtime codex` to register the MCP server and install the Oraculum skills and rules.",
      ],
    }),
  ];

  return {
    mode: "setup-status",
    cwd: projectRoot,
    projectInitialized,
    ...(projectInitialized ? { configPath } : {}),
    ...(advancedConfigPresent ? { advancedConfigPath } : {}),
    targetPrefix: "orc",
    hosts,
    summary: summarizeSetupDiagnosticsHosts(hosts),
  };
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
      ? `${host.host} is ready for host-native \`orc ...\` commands.`
      : `Run \`oraculum setup --runtime ${host.host}\` to finish host-native \`orc ...\` routing, then use \`oraculum setup status --runtime ${host.host}\` to verify the wiring.`;
  }

  return hosts.every((host) => host.status === "ready")
    ? "Claude Code and Codex are ready for host-native `orc ...` commands."
    : "Run `oraculum setup --runtime <host>` to finish host-native `orc ...` routing, then use `oraculum setup status` to verify the wiring.";
}

export function hasClaudePluginArtifactsInstalled(pluginsDir: string): boolean {
  if (!existsSync(pluginsDir)) {
    return false;
  }

  if (existsSync(join(pluginsDir, "oraculum")) || existsSync(join(pluginsDir, "@oraculum"))) {
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
    const installed = parsed.plugins?.["oraculum@oraculum"];
    if (!Array.isArray(installed)) {
      return false;
    }

    return installed.some(
      (entry) =>
        entry.version === APP_VERSION &&
        typeof entry.installPath === "string" &&
        existsSync(join(entry.installPath, "plugin.json")),
    );
  } catch {
    return false;
  }
}

function buildHostDiagnostics(options: {
  artifactsInstalled: boolean;
  host: SetupStatusToolResponse["hosts"][number]["host"];
  notes: string[];
  registered: boolean;
}): SetupStatusToolResponse["hosts"][number] {
  const status = computeHostSetupStatus(options.registered, options.artifactsInstalled);
  return {
    host: options.host,
    status,
    registered: options.registered,
    artifactsInstalled: options.artifactsInstalled,
    nextAction:
      status === "ready"
        ? `Use \`orc ...\` directly in ${options.host === "claude-code" ? "Claude Code" : "Codex"}.`
        : `Run \`oraculum setup --runtime ${options.host}\`.`,
    notes: options.notes,
  };
}

function toPortableDisplayPath(path: string): string {
  return path.replaceAll("\\", "/");
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

function hasClaudePluginInstalled(): boolean {
  return hasClaudePluginArtifactsInstalled(join(homedir(), ".claude", "plugins"));
}

function hasCodexMcpServer(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return /\[mcp_servers\.oraculum\]/u.test(raw);
  } catch {
    return false;
  }
}

function hasCodexArtifactsInstalled(skillsDir: string, rulesDir: string): boolean {
  if (!existsSync(skillsDir) || !existsSync(rulesDir)) {
    return false;
  }

  const expectedRule = join(rulesDir, getExpectedCodexRuleFileName());
  if (!existsSync(expectedRule)) {
    return false;
  }

  return getExpectedCodexSkillDirs().every((dirName) => existsSync(join(skillsDir, dirName)));
}

function computeHostSetupStatus(
  registered: boolean,
  artifactsInstalled: boolean,
): "ready" | "partial" | "needs-setup" {
  if (registered && artifactsInstalled) {
    return "ready";
  }

  if (!registered && !artifactsInstalled) {
    return "needs-setup";
  }

  return "partial";
}
