import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

import { APP_VERSION } from "../../core/constants.js";
import { OraculumError } from "../../core/errors.js";
import { writeTextFileAtomically } from "../project.js";
import { buildClaudePluginMcpConfigFromInvocation } from "./mcp-config.js";
import { getExpectedClaudeCommandFiles, getExpectedClaudeSkillDirs } from "./packaged.js";
import {
  CLAUDE_LEGACY_PLUGIN_NAMES,
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_NAME,
  CLAUDE_PLUGIN_VERSION,
} from "./shared.js";

export async function prepareClaudeSetupRoot(options: {
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
  await writeTextFileAtomically(
    join(installRoot, ".claude-plugin", ".mcp.json"),
    `${JSON.stringify(buildClaudePluginMcpConfigFromInvocation(options.mcpInvocation), null, 2)}\n`,
  );
  return installRoot;
}

export function assertPackagedClaudeArtifacts(packagedRoot: string): void {
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

export async function pruneClaudePluginArtifacts(homeDir: string): Promise<void> {
  await pruneSelectedClaudePluginArtifacts(homeDir, [
    CLAUDE_PLUGIN_NAME,
    ...CLAUDE_LEGACY_PLUGIN_NAMES,
  ]);
}

export async function pruneSelectedClaudePluginArtifacts(
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

export function hasClaudePluginInstallArtifacts(
  entry: { installPath?: string } | undefined,
): boolean {
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
