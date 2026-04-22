import { fileURLToPath } from "node:url";

import type { CommandManifestEntry } from "../../domain/chat-native.js";
import { CODEX_RULE_FILENAME, CODEX_SETUP_GUIDANCE, toCodexSkillDir } from "./shared.js";

export function getPackagedCodexRoot(): string {
  return fileURLToPath(new URL("../../../dist/chat-native/codex", import.meta.url));
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

export function getExpectedCodexSkillDirs(): string[] {
  return ["consult", "plan", "verdict", "verdict-archive", "crown", "draft", "init"].map(
    toCodexSkillDir,
  );
}

export function getExpectedCodexRuleFileName(): string {
  return CODEX_RULE_FILENAME;
}

function renderCodexRules(manifest: readonly CommandManifestEntry[]): string {
  const rows = manifest
    .map((entry) => `| \`orc ${entry.path.join(" ")}\` | \`${entry.mcpTool}\` |`)
    .join("\n");

  return [
    "# Oraculum for Codex",
    "",
    "Handle exact `orc ...` commands through Oraculum MCP tools.",
    "",
    "## Exact-Prefix Dispatch",
    "",
    "For an exact `orc <command>` input:",
    "- parse arguments shell-style",
    "- call the mapped MCP tool immediately",
    "- no preamble, acknowledgement, or routing narration",
    "- no repo reads, `git status`, README, AGENTS, or skill reads first",
    "- never run `orc ...` in the shell",
    "- if the MCP tool has not been called yet, do not send a user message",
    "",
    "| User Input | MCP Tool |",
    "| --- | --- |",
    rows,
    "",
    "### Argument Mapping",
    "",
    "- `orc consult <taskInput>` -> call `oraculum_consult` with `cwd` and `taskInput` only; advanced planning controls live in `.oraculum/config.json`, `.oraculum/advanced.json`, or the task contract.",
    "- `orc plan <taskInput>` -> call `oraculum_plan` with `cwd` and `taskInput` only; clarification answers belong in the revised task text.",
    "- `orc draft <taskInput>` -> call `oraculum_draft` with the same task-only mapping as plan.",
    "- `orc verdict [consultationId]` -> call `oraculum_verdict` with `cwd` and optional `consultationId`.",
    "- `orc verdict archive [count]` -> call `oraculum_verdict_archive` with `cwd` and optional `count`.",
    "- `orc crown [materializationName] [--allow-unsafe]` -> call `oraculum_crown` with `cwd`, optional `materializationName`, and optional `allowUnsafe=true`.",
    "- `orc init [--force]` -> call `oraculum_init` with `cwd` and optional `force=true`.",
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
  const skillName = entry.id === "consult" ? "task" : entry.id;
  const description =
    entry.id === "consult"
      ? "Primary task route."
      : `Exact \`orc ${entry.path.join(" ")}\` handler.`;
  const argsLine =
    entry.id === "consult" || entry.id === "plan" || entry.id === "draft"
      ? "Args: cwd=current-directory; taskInput=user text after command only; do not parse planning flags."
      : entry.id === "verdict"
        ? "Args: cwd=current-directory; optional first positional=consultationId."
        : entry.id === "verdict-archive"
          ? "Args: cwd=current-directory; optional first positional=count."
          : entry.id === "crown"
            ? "Args: cwd=current-directory; optional first positional=materializationName; optional --allow-unsafe => allowUnsafe=true."
            : "Args: cwd=current-directory; optional --force => force=true.";

  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "---",
    "",
    "MCP route only.",
    `Tool: ${entry.mcpTool}`,
    argsLine,
    "Immediate tool call only.",
    "",
  ].join("\n");
}
