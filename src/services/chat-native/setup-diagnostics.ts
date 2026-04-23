import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { APP_VERSION } from "../../core/constants.js";
import { getAdvancedConfigPath, getConfigPath, resolveProjectRoot } from "../../core/paths.js";
import type { SetupStatusActionResponse } from "../../domain/chat-native.js";
import { setupStatusActionResponseSchema } from "../../domain/chat-native.js";
import {
  getExpectedClaudeCommandFiles,
  getExpectedClaudeSkillDirs,
} from "../claude-chat-native.js";
import { getExpectedCodexRuleFileName, getExpectedCodexSkillDirs } from "../codex-chat-native.js";

const MANAGED_CLAUDE_PLUGIN_KEYS = ["orc@oraculum", "oraculum@oraculum"] as const;
const MANAGED_CLAUDE_PLUGIN_DIRS = ["orc", "@orc", "oraculum", "@oraculum"] as const;

export function buildSetupDiagnosticsResponse(cwd: string): SetupStatusActionResponse {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);
  const claudePluginsDir = join(homedir(), ".claude", "plugins");
  const claudeInstallRoot = join(homedir(), ".oraculum", "chat-native", "claude-code", APP_VERSION);
  const codexSkillsDir = join(homedir(), ".codex", "skills");
  const codexRulesDir = join(homedir(), ".codex", "rules");
  const projectInitialized = existsSync(configPath);
  const advancedConfigPresent = existsSync(advancedConfigPath);

  const claudeArtifactsInstalled = hasClaudePluginInstalled(claudeInstallRoot);
  const claudeRegistered = claudeArtifactsInstalled;
  const claudeLaunchTransport = computeLaunchTransportMode(
    "claude-code",
    claudeRegistered,
    claudeArtifactsInstalled,
  );

  const codexArtifactsInstalled = hasCodexArtifactsInstalled(codexSkillsDir, codexRulesDir);
  const codexRegistered = codexArtifactsInstalled;
  const codexLaunchTransport = computeLaunchTransportMode(
    "codex",
    codexRegistered,
    codexArtifactsInstalled,
  );

  const hosts = [
    buildHostDiagnostics({
      artifactsInstalled: claudeArtifactsInstalled,
      host: "claude-code",
      launchTransport: claudeLaunchTransport,
      notes: [
        `Expected Claude plugin cache root: ${toPortableDisplayPath(claudePluginsDir)}`,
        `Expected Claude install root: ${toPortableDisplayPath(claudeInstallRoot)}`,
        "Primary surface: use `orc ...` directly inside Claude Code after setup.",
        "Under the hood, Oraculum routes exact prefixes to `oraculum orc ...` direct CLI commands.",
        "Run `oraculum setup --runtime claude-code` to install the Oraculum plugin.",
      ],
      registered: claudeRegistered,
    }),
    buildHostDiagnostics({
      artifactsInstalled: codexArtifactsInstalled,
      host: "codex",
      launchTransport: codexLaunchTransport,
      notes: [
        `Expected skill install root: ${toPortableDisplayPath(codexSkillsDir)}`,
        `Expected rule install root: ${toPortableDisplayPath(codexRulesDir)}`,
        "Primary surface: use `orc ...` directly inside Codex after setup.",
        "Under the hood, Oraculum routes exact prefixes to `oraculum orc ...` direct CLI commands.",
        "Run `oraculum setup --runtime codex` to install the Oraculum skills and rules.",
      ],
      registered: codexRegistered,
    }),
  ];

  return setupStatusActionResponseSchema.parse({
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
  diagnostics: SetupStatusActionResponse,
  host?: SetupStatusActionResponse["hosts"][number]["host"],
): SetupStatusActionResponse {
  const hosts = host ? diagnostics.hosts.filter((entry) => entry.host === host) : diagnostics.hosts;

  return setupStatusActionResponseSchema.parse({
    ...diagnostics,
    hosts,
    summary: summarizeSetupDiagnosticsHosts(hosts),
  });
}

export function summarizeSetupDiagnosticsHosts(
  hosts: Array<{
    artifactsInstalled: boolean;
    host: SetupStatusActionResponse["hosts"][number]["host"];
    launchTransport: SetupStatusActionResponse["hosts"][number]["launchTransport"];
    registered: boolean;
    status: SetupStatusActionResponse["hosts"][number]["status"];
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
      ? `${host.host} is ready for interactive \`orc ...\` commands.`
      : `Run \`oraculum setup --runtime ${host.host}\` to enable interactive \`orc ...\`, then use \`oraculum setup status --runtime ${host.host}\` to verify the wiring.`;
  }

  return hosts.every((host) => host.status === "ready")
    ? "Claude Code and Codex are ready for interactive `orc ...` commands."
    : "Run `oraculum setup --runtime <host>` to enable interactive `orc ...`, then use `oraculum setup status` to verify the wiring.";
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
  host: SetupStatusActionResponse["hosts"][number]["host"];
  launchTransport: SetupStatusActionResponse["hosts"][number]["launchTransport"];
  notes: string[];
  registered: boolean;
}): SetupStatusActionResponse["hosts"][number] {
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
        ? `Use \`orc ...\` directly in ${options.host === "claude-code" ? "Claude Code" : "Codex"}.`
        : `Run \`oraculum setup --runtime ${options.host}\`.`,
    notes: options.notes,
  };
}

function computeHostSetupStatus(
  registered: boolean,
  artifactsInstalled: boolean,
  launchTransport: SetupStatusActionResponse["hosts"][number]["launchTransport"],
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
  host: SetupStatusActionResponse["hosts"][number]["host"],
  registered: boolean,
  artifactsInstalled: boolean,
): SetupStatusActionResponse["hosts"][number]["launchTransport"] {
  if (!registered || !artifactsInstalled) {
    return "unavailable";
  }

  return hasCommandOnPath(host === "codex" ? "codex" : "claude") ? "official" : "unavailable";
}

function hasCurrentClaudePluginDir(path: string): boolean {
  return hasCurrentClaudePluginArtifacts(path);
}

function hasCurrentClaudePluginArtifacts(path: string): boolean {
  const pluginJsonPath = join(path, "plugin.json");
  if (!existsSync(pluginJsonPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as {
      version?: unknown;
    };
    if (parsed.version !== APP_VERSION) {
      return false;
    }

    return getExpectedClaudeSkillDirs().every((dirName) => {
      const skillPath = join(path, "skills", dirName, "SKILL.md");
      return existsSync(skillPath) && readFileSync(skillPath, "utf8").includes("Direct CLI only.");
    });
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
