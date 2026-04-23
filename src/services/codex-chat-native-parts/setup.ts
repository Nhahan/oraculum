import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  resolveDirectCliInvocation,
  rewriteDirectRouteInvocation,
} from "../chat-native/direct-route.js";
import { getPackagedCodexRoot } from "./packaged.js";
import {
  assertPackagedCodexArtifacts,
  installCodexArtifacts,
  prepareCodexSetupRoot,
  pruneManagedCodexRules,
  pruneManagedCodexSkills,
} from "./setup-artifacts.js";
import type {
  CodexSetupOptions,
  CodexSetupResult,
  CodexUninstallOptions,
  CodexUninstallResult,
} from "./shared.js";

export async function setupCodexHost(options: CodexSetupOptions = {}): Promise<CodexSetupResult> {
  const homeDir = options.homeDir ?? homedir();
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

  await rewriteDirectRouteInvocation({
    invocation: options.directCliInvocation ?? resolveDirectCliInvocation(),
    root: installRoot,
  });
  await installCodexArtifacts({
    installRoot,
    rulesRoot,
    skillsRoot,
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
  const codexDir = join(homeDir, ".codex");
  const skillsRoot = join(codexDir, "skills");
  const rulesRoot = join(codexDir, "rules");
  const configPath = join(codexDir, "config.toml");
  const installRoot = join(homeDir, ".oraculum", "chat-native", "codex");

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
