import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import { CLAUDE_MARKETPLACE_NAME, CLAUDE_PLUGIN_NAME, extractSubprocessError } from "./shared.js";

export async function addClaudeMarketplace(
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

export async function removeClaudeMarketplace(
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

export async function installClaudePlugin(
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

export async function uninstallClaudePlugin(
  claudeBinaryPath: string,
  claudeArgs: string[],
  env: NodeJS.ProcessEnv,
  pluginName: string,
): Promise<void> {
  const uninstall = await runSubprocess({
    command: claudeBinaryPath,
    args: [...claudeArgs, "plugin", "uninstall", pluginName],
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
