import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  registerCodexMcpServer,
  removeCodexMcpConfigEntry,
  unregisterCodexMcpServer,
} from "./mcp-config.js";
import { getPackagedCodexRoot } from "./packaged.js";
import {
  assertPackagedCodexArtifacts,
  installCodexArtifacts,
  prepareCodexSetupRoot,
  pruneManagedCodexRules,
  pruneManagedCodexSkills,
} from "./setup-artifacts.js";
import {
  type CodexSetupOptions,
  type CodexSetupResult,
  type CodexUninstallOptions,
  type CodexUninstallResult,
  resolveNodeCliInvocation,
} from "./shared.js";

export async function setupCodexHost(options: CodexSetupOptions = {}): Promise<CodexSetupResult> {
  const homeDir = options.homeDir ?? homedir();
  const codexBinaryPath = options.codexBinaryPath ?? "codex";
  const codexArgs = options.codexArgs ?? [];
  const env = {
    ...process.env,
    ...options.env,
    HOME: homeDir,
  };

  const packagedRoot = options.packagedRoot ?? getPackagedCodexRoot();
  assertPackagedCodexArtifacts(packagedRoot);
  const installRoot = await prepareCodexSetupRoot({
    homeDir,
    packagedRoot,
  });
  const codexDir = join(homeDir, ".codex");
  const skillsRoot = join(codexDir, "skills");
  const rulesRoot = join(codexDir, "rules");
  const configPath = join(codexDir, "config.toml");

  await installCodexArtifacts({
    installRoot,
    rulesRoot,
    skillsRoot,
  });
  await registerCodexMcpServer({
    codexArgs,
    codexBinaryPath,
    env,
    mcpInvocation: options.mcpInvocation ?? resolveNodeCliInvocation(),
  });

  return {
    configPath,
    installRoot,
    packagedRoot,
    registered: true,
    rulesRoot,
    skillsRoot,
  };
}

export async function uninstallCodexHost(
  options: CodexUninstallOptions = {},
): Promise<CodexUninstallResult> {
  const homeDir = options.homeDir ?? homedir();
  const codexBinaryPath = options.codexBinaryPath ?? "codex";
  const codexArgs = options.codexArgs ?? [];
  const env = {
    ...process.env,
    ...options.env,
    HOME: homeDir,
  };
  const codexDir = join(homeDir, ".codex");
  const skillsRoot = join(codexDir, "skills");
  const rulesRoot = join(codexDir, "rules");
  const configPath = join(codexDir, "config.toml");
  const installRoot = join(homeDir, ".oraculum", "chat-native", "codex");

  await unregisterCodexMcpServer({
    codexArgs,
    codexBinaryPath,
    env,
  });
  await removeCodexMcpConfigEntry(configPath);
  await pruneManagedCodexSkills(skillsRoot, new Set());
  await pruneManagedCodexRules(rulesRoot, new Set());
  await rm(installRoot, { force: true, recursive: true });

  return {
    configPath,
    installRoot,
    registered: false,
    rulesRoot,
    skillsRoot,
  };
}
