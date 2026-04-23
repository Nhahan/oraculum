import { APP_VERSION } from "../../core/constants.js";
import type { DirectCliInvocation } from "../chat-native/direct-route.js";

export interface CodexSetupOptions {
  codexArgs?: string[];
  codexBinaryPath?: string;
  directCliInvocation?: DirectCliInvocation;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  packagedRoot?: string;
  platform?: NodeJS.Platform;
}

export interface CodexSetupResult {
  configPath: string;
  installRoot: string;
  packagedRoot: string;
  registered: boolean;
  rulesRoot: string;
  skillsRoot: string;
}

export interface CodexUninstallOptions {
  codexArgs?: string[];
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export interface CodexUninstallResult {
  configPath: string;
  installRoot: string;
  registered: boolean;
  rulesRoot: string;
  skillsRoot: string;
}

export const CODEX_RULE_FILENAME = "oraculum.md";
const CODEX_SKILL_PREFIX = "route-";
export const CODEX_SETUP_GUIDANCE = "Run `oraculum setup --runtime codex`.";
export const CODEX_INSTALL_VERSION = APP_VERSION;

export function toCodexSkillDir(commandId: string): string {
  return `${CODEX_SKILL_PREFIX}${commandId}`;
}
