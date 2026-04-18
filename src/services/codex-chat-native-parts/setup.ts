import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { runSubprocess } from "../../core/subprocess.js";
import { getExpectedCodexSkillDirs, getPackagedCodexRoot } from "./packaged.js";
import {
  CODEX_INSTALL_VERSION,
  CODEX_LEGACY_MCP_SERVER_NAMES,
  CODEX_MCP_SERVER_NAME,
  CODEX_MCP_STARTUP_TIMEOUT_SEC,
  CODEX_MCP_TOOL_TIMEOUT_SEC,
  CODEX_RULE_FILENAME,
  CODEX_SKILL_PREFIX,
  type CodexSetupOptions,
  type CodexSetupResult,
  type CodexUninstallOptions,
  type CodexUninstallResult,
  extractSubprocessError,
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

async function prepareCodexSetupRoot(options: {
  homeDir: string;
  packagedRoot: string;
}): Promise<string> {
  const installRoot = join(
    options.homeDir,
    ".oraculum",
    "chat-native",
    "codex",
    CODEX_INSTALL_VERSION,
  );
  await rm(installRoot, { force: true, recursive: true });
  await cp(options.packagedRoot, installRoot, {
    force: true,
    recursive: true,
  });
  return installRoot;
}

function assertPackagedCodexArtifacts(packagedRoot: string): void {
  const expectedPaths = [
    join(packagedRoot, "rules", CODEX_RULE_FILENAME),
    ...getExpectedCodexSkillDirs().map((dirName) =>
      join(packagedRoot, "skills", dirName, "SKILL.md"),
    ),
  ];

  const missing = expectedPaths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new OraculumError(
      [
        "Packaged Codex host artifacts are incomplete.",
        "Build Oraculum first so setup can install the generated host artifacts.",
        ...missing.map((path) => `Missing: ${path}`),
      ].join("\n"),
    );
  }
}

async function installCodexArtifacts(options: {
  installRoot: string;
  rulesRoot: string;
  skillsRoot: string;
}): Promise<void> {
  await mkdir(options.skillsRoot, { recursive: true });
  await mkdir(options.rulesRoot, { recursive: true });

  const packagedSkillsRoot = join(options.installRoot, "skills");
  const packagedRulesRoot = join(options.installRoot, "rules");

  const packagedSkillDirs = await readdir(packagedSkillsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const desiredSkillNames = packagedSkillDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const desired of desiredSkillNames) {
    const sourcePath = join(packagedSkillsRoot, desired);
    const targetPath = join(options.skillsRoot, desired);
    await rm(targetPath, { recursive: true, force: true });
    await cp(sourcePath, targetPath, {
      force: true,
      recursive: true,
    });
  }

  await pruneManagedCodexSkills(options.skillsRoot, new Set(desiredSkillNames));

  const packagedRules = await readdir(packagedRulesRoot, { withFileTypes: true });
  const desiredRuleNames = packagedRules
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const desired of desiredRuleNames) {
    const sourcePath = join(packagedRulesRoot, desired);
    const targetPath = join(options.rulesRoot, desired);
    await rm(targetPath, { recursive: true, force: true });
    await cp(sourcePath, targetPath, {
      force: true,
      recursive: true,
    });
  }

  await pruneManagedCodexRules(options.rulesRoot, new Set(desiredRuleNames));
}

async function pruneManagedCodexSkills(skillsRoot: string, desired: Set<string>): Promise<void> {
  try {
    await readdir(skillsRoot);
  } catch {
    return;
  }

  const managedPrefixes = new Set([CODEX_SKILL_PREFIX, "oraculum-"]);
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (
      ![...managedPrefixes].some((prefix) => entry.name.startsWith(prefix)) ||
      desired.has(entry.name)
    ) {
      continue;
    }

    await rm(join(skillsRoot, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

async function pruneManagedCodexRules(rulesRoot: string, desired: Set<string>): Promise<void> {
  try {
    await readdir(rulesRoot);
  } catch {
    return;
  }

  for (const entry of await readdir(rulesRoot, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      (!entry.name.startsWith(CODEX_MCP_SERVER_NAME) && entry.name !== CODEX_RULE_FILENAME) ||
      desired.has(entry.name)
    ) {
      continue;
    }

    await rm(join(rulesRoot, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

async function registerCodexMcpServer(options: {
  codexArgs: string[];
  codexBinaryPath: string;
  env: NodeJS.ProcessEnv;
  mcpInvocation: {
    args: string[];
    command: string;
  };
}): Promise<void> {
  for (const serverName of [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES]) {
    await runSubprocess({
      command: options.codexBinaryPath,
      args: [...options.codexArgs, "mcp", "remove", serverName],
      cwd: process.cwd(),
      env: options.env,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  }

  const addResult = await runSubprocess({
    command: options.codexBinaryPath,
    args: [
      ...options.codexArgs,
      "mcp",
      "add",
      CODEX_MCP_SERVER_NAME,
      "--env",
      "ORACULUM_AGENT_RUNTIME=codex",
      "--env",
      "ORACULUM_LLM_BACKEND=codex",
      "--",
      options.mcpInvocation.command,
      ...options.mcpInvocation.args,
      "mcp",
      "serve",
    ],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  });
  if (addResult.exitCode !== 0) {
    throw new OraculumError(
      `Failed to register the Oraculum Codex MCP server: ${extractSubprocessError(addResult)}`,
    );
  }

  const verifyResult = await runSubprocess({
    command: options.codexBinaryPath,
    args: [...options.codexArgs, "mcp", "get", CODEX_MCP_SERVER_NAME, "--json"],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  });
  if (verifyResult.exitCode !== 0) {
    throw new OraculumError(
      `Failed to verify the Oraculum Codex MCP server: ${extractSubprocessError(verifyResult)}`,
    );
  }

  await upsertCodexMcpTimeouts(join(options.env.HOME ?? homedir(), ".codex", "config.toml"));
}

async function unregisterCodexMcpServer(options: {
  codexArgs: string[];
  codexBinaryPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  for (const serverName of [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES]) {
    await runSubprocess({
      command: options.codexBinaryPath,
      args: [...options.codexArgs, "mcp", "remove", serverName],
      cwd: process.cwd(),
      env: options.env,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  }
}

async function removeCodexMcpConfigEntry(configPath: string): Promise<void> {
  try {
    const raw = await readFile(configPath, "utf8");
    const next = [CODEX_MCP_SERVER_NAME, ...CODEX_LEGACY_MCP_SERVER_NAMES].reduce(
      (content, serverName) => stripCodexMcpServerSection(content, `mcp_servers.${serverName}`),
      raw,
    );
    if (next !== raw) {
      await writeFile(configPath, next, "utf8");
    }
  } catch {
    // Leave best-effort uninstall cleanup to the managed artifacts when the config is absent
    // or unreadable.
  }
}

function stripCodexMcpServerSection(content: string, sectionPrefix: string): string {
  const lines = content.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = /^\[(.+)\]$/u.exec(trimmed);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      if (!sectionName) {
        skipping = false;
        kept.push(line);
        continue;
      }
      skipping = sectionName === sectionPrefix || sectionName.startsWith(`${sectionPrefix}.`);
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") {
    kept.pop();
  }

  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

async function upsertCodexMcpTimeouts(configPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/u);
  const output: string[] = [];
  let inTargetSection = false;
  let insertedStartup = false;
  let insertedTool = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = /^\[(.+)\]$/u.exec(trimmed);
    if (sectionMatch) {
      if (inTargetSection) {
        if (!insertedStartup) {
          output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
        }
        if (!insertedTool) {
          output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
        }
      }
      inTargetSection = sectionMatch[1] === `mcp_servers.${CODEX_MCP_SERVER_NAME}`;
      insertedStartup = false;
      insertedTool = false;
      output.push(line);
      continue;
    }

    if (inTargetSection && trimmed.startsWith("startup_timeout_sec")) {
      output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
      insertedStartup = true;
      continue;
    }
    if (inTargetSection && trimmed.startsWith("tool_timeout_sec")) {
      output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
      insertedTool = true;
      continue;
    }

    output.push(line);
  }

  if (inTargetSection) {
    if (!insertedStartup) {
      output.push(`startup_timeout_sec = ${CODEX_MCP_STARTUP_TIMEOUT_SEC}`);
    }
    if (!insertedTool) {
      output.push(`tool_timeout_sec = ${CODEX_MCP_TOOL_TIMEOUT_SEC}`);
    }
  }

  const normalized = `${output.join("\n").replace(/\n+$/u, "")}\n`;
  if (normalized !== raw) {
    await writeFile(configPath, normalized, "utf8");
  }
}
