import { APP_VERSION } from "../../core/constants.js";
import { OraculumError } from "../../core/errors.js";

export interface CodexSetupOptions {
  codexArgs?: string[];
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  mcpInvocation?: {
    args: string[];
    command: string;
  };
  packagedRoot?: string;
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
}

export interface CodexUninstallResult {
  configPath: string;
  installRoot: string;
  registered: boolean;
  rulesRoot: string;
  skillsRoot: string;
}

export const CODEX_RULE_FILENAME = "oraculum.md";
export const CODEX_SKILL_PREFIX = "route-";
export const CODEX_MCP_SERVER_NAME = "orc";
export const CODEX_LEGACY_MCP_SERVER_NAMES = ["oraculum"] as const;
export const CODEX_SETUP_GUIDANCE = "Run `oraculum setup --runtime codex`.";
export const CODEX_INSTALL_VERSION = APP_VERSION;
export const CODEX_MCP_STARTUP_TIMEOUT_SEC = 60;
export const CODEX_MCP_TOOL_TIMEOUT_SEC = 1800;

export function extractSubprocessError(result: { stderr: string; stdout: string }): string {
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

export function resolveNodeCliInvocation(): { args: string[]; command: string } {
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    throw new OraculumError("Cannot determine the current Oraculum CLI entry for Codex setup.");
  }

  return {
    command: process.execPath,
    args: [cliEntry],
  };
}

export function toCodexSkillDir(commandId: string): string {
  return `${CODEX_SKILL_PREFIX}${commandId}`;
}
