import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../core/constants.js";
import { OraculumError } from "../core/errors.js";
import { runSubprocess } from "../core/subprocess.js";
import type { CommandManifestEntry } from "../domain/chat-native.js";

interface CodexSetupOptions {
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

interface CodexSetupResult {
  configPath: string;
  installRoot: string;
  packagedRoot: string;
  registered: boolean;
  rulesRoot: string;
  skillsRoot: string;
}

interface CodexUninstallOptions {
  codexArgs?: string[];
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

interface CodexUninstallResult {
  configPath: string;
  installRoot: string;
  registered: boolean;
  rulesRoot: string;
  skillsRoot: string;
}

const CODEX_RULE_FILENAME = "oraculum.md";
const CODEX_SKILL_PREFIX = "oraculum-";
const CODEX_SETUP_GUIDANCE = "Run `oraculum setup --runtime codex`.";

export function getPackagedCodexRoot(): string {
  return fileURLToPath(new URL("../../dist/chat-native/codex", import.meta.url));
}

export function buildCodexRuleFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return [
    {
      path: `rules/${CODEX_RULE_FILENAME}`,
      content: renderCodexRules(manifest),
    },
  ];
}

export function buildCodexSkillFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return manifest.map((entry) => ({
    path: `skills/${toCodexSkillDir(entry.id)}/SKILL.md`,
    content: renderCodexSkill(entry),
  }));
}

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

export function getExpectedCodexSkillDirs(): string[] {
  return ["consult", "verdict", "verdict-archive", "crown", "draft", "init"].map(toCodexSkillDir);
}

export function getExpectedCodexRuleFileName(): string {
  return CODEX_RULE_FILENAME;
}

function renderCodexRules(manifest: readonly CommandManifestEntry[]): string {
  const rows = manifest
    .map(
      (entry) =>
        `| \`orc ${entry.path.join(" ")}\` | \`${toCodexSkillDir(entry.id)}\` | \`${entry.mcpTool}\` |`,
    )
    .join("\n");

  return [
    "# Oraculum for Codex",
    "",
    "Use Oraculum when the user is asking to run Oraculum consultations, reopen verdicts, browse the consultation archive, or crown a survivor.",
    "",
    "## Critical: Exact-Prefix Routing",
    "",
    "When the user types an exact `orc <command>` command, you MUST NOT interpret it as natural language and you MUST NOT do the work directly.",
    "Immediately use the matching installed Oraculum skill and route to the mapped MCP tool.",
    "Parse command arguments shell-style before calling the MCP tool. Do not pass option flags through as raw task text.",
    "",
    "| User Input | Skill | MCP Tool |",
    "| --- | --- | --- |",
    rows,
    "",
    "If the Oraculum MCP tool is unavailable, respond with explicit setup guidance instead of improvising:",
    "",
    `- ${CODEX_SETUP_GUIDANCE}`,
    "",
    "If the user request is unrelated to `orc` commands or Oraculum workflows, handle it normally.",
    "",
  ].join("\n");
}

function renderCodexSkill(entry: CommandManifestEntry): string {
  return [
    "---",
    `name: ${toCodexSkillDir(entry.id)}`,
    `description: Exact-prefix Oraculum ${entry.id} routing for Codex.`,
    "---",
    "",
    `# Oraculum ${entry.id}`,
    "",
    `When the user typed an exact \`orc ${entry.path.join(" ")}\` command, do not treat it as natural language and do not perform the task yourself.`,
    "",
    "## Required Action",
    "",
    `Call the MCP tool \`${entry.mcpTool}\`.`,
    "",
    "After the MCP tool succeeds, report the verified tool result concisely and stop. Do not run Bash, Edit, Write, or ad-hoc follow-up work unless the user explicitly asks.",
    "",
    "## Argument Mapping",
    "",
    ...buildCodexSkillArgumentLines(entry),
    "",
    "## Setup Failure",
    "",
    `If the MCP tool is unavailable, tell the user exactly: ${CODEX_SETUP_GUIDANCE}`,
    "",
    "## Usage",
    "",
    "```",
    ...entry.examples,
    "```",
    "",
  ].join("\n");
}

function buildCodexSkillArgumentLines(entry: CommandManifestEntry): string[] {
  const shared = ["- `cwd`: the current working directory where the user invoked the command"];

  switch (entry.id) {
    case "consult":
      return [
        ...shared,
        "- `taskInput`: the first positional argument after removing recognized flags from the command",
        "- optional `--agent <claude-code|codex>`; default to `codex` when omitted",
        "- optional `--candidates <n>`",
        "- optional `--timeout-ms <ms>`",
        '- Example: `orc consult tasks/fix.md` -> `{ taskInput: "tasks/fix.md", agent: "codex" }`',
        '- Example: `orc consult tasks/fix.md --agent claude-code --candidates 1` -> `{ taskInput: "tasks/fix.md", agent: "claude-code", candidates: 1 }`',
      ];
    case "draft":
      return [
        ...shared,
        "- `taskInput`: the first positional argument after removing recognized flags from the command",
        "- optional `--agent <claude-code|codex>`; default to `codex` when omitted",
        "- optional `--candidates <n>`",
        '- Example: `orc draft tasks/fix.md` -> `{ taskInput: "tasks/fix.md", agent: "codex" }`',
        '- Example: `orc draft tasks/fix.md --agent codex --candidates 2` -> `{ taskInput: "tasks/fix.md", agent: "codex", candidates: 2 }`',
      ];
    case "verdict":
      return [...shared, "- optional `consultationId`: the first positional argument if present"];
    case "verdict-archive":
      return [...shared, "- optional `count`: the first positional argument if present"];
    case "crown":
      return [
        ...shared,
        "- optional `branchName`: the first positional argument after `orc crown` when present; required only for Git-backed crowning",
        "- omit `branchName` when the user typed bare `orc crown`",
        "- in non-Git workspace-sync mode, Oraculum treats a provided `branchName` value as a materialization label rather than a Git branch",
        "- the chat-native crowning path uses the recommended survivor automatically",
        '- Example: `orc crown fix/greet` -> `{ branchName: "fix/greet" }`',
        "- Example: `orc crown` -> no branchName field",
      ];
    case "init":
      return [...shared, "- optional `force`: parse the presence of `--force` as `true`"];
    default:
      return shared;
  }
}

async function prepareCodexSetupRoot(options: {
  homeDir: string;
  packagedRoot: string;
}): Promise<string> {
  const installRoot = join(options.homeDir, ".oraculum", "chat-native", "codex", APP_VERSION);
  await cp(options.packagedRoot, installRoot, {
    force: true,
    recursive: true,
  });
  return installRoot;
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

  const packagedSkillDirs = await readdir(packagedSkillsRoot, { withFileTypes: true });
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

  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(CODEX_SKILL_PREFIX) || desired.has(entry.name)) {
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
      (!entry.name.startsWith("oraculum") && entry.name !== CODEX_RULE_FILENAME) ||
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
  await runSubprocess({
    command: options.codexBinaryPath,
    args: [...options.codexArgs, "mcp", "remove", "oraculum"],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  }).catch(() => undefined);

  const addResult = await runSubprocess({
    command: options.codexBinaryPath,
    args: [
      ...options.codexArgs,
      "mcp",
      "add",
      "oraculum",
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
    args: [...options.codexArgs, "mcp", "get", "oraculum", "--json"],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  });
  if (verifyResult.exitCode !== 0) {
    throw new OraculumError(
      `Failed to verify the Oraculum Codex MCP server: ${extractSubprocessError(verifyResult)}`,
    );
  }
}

async function unregisterCodexMcpServer(options: {
  codexArgs: string[];
  codexBinaryPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  await runSubprocess({
    command: options.codexBinaryPath,
    args: [...options.codexArgs, "mcp", "remove", "oraculum"],
    cwd: process.cwd(),
    env: options.env,
    timeoutMs: 30_000,
  }).catch(() => undefined);
}

function resolveNodeCliInvocation(): { args: string[]; command: string } {
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    throw new OraculumError("Cannot determine the current Oraculum CLI entry for Codex setup.");
  }

  return {
    command: process.execPath,
    args: [cliEntry],
  };
}

function toCodexSkillDir(commandId: string): string {
  return `${CODEX_SKILL_PREFIX}${commandId}`;
}

function extractSubprocessError(result: { stderr: string; stdout: string }): string {
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
