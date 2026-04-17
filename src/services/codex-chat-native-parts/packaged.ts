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
    .map(
      (entry) =>
        `| \`orc ${entry.path.join(" ")}\` | \`${toCodexSkillDir(entry.id)}\` | \`${entry.mcpTool}\` |`,
    )
    .join("\n");

  return [
    "# Oraculum for Codex",
    "",
    "Use Oraculum when the user is asking to run Oraculum consultations, reopen verdicts, browse the consultation archive, or crown a recommended result.",
    "",
    "## Critical: Exact-Prefix Routing",
    "",
    "When the user types an exact `orc <command>` command, you MUST NOT interpret it as natural language and you MUST NOT do the work directly.",
    "Immediately use the matching installed Oraculum skill and route to the mapped MCP tool.",
    "Parse command arguments shell-style before calling the MCP tool. Do not pass option flags through as raw task text.",
    "Do not send a preamble before the MCP tool call.",
    "Do not mention AGENTS.md, skills, MCP, routing, internal tool calls, or that you are about to call Oraculum.",
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
  const postToolInstruction =
    entry.id === "consult"
      ? "Call the MCP tool immediately with no preamble. After the MCP tool succeeds, report only the user-relevant result concisely and stop. Do not automatically invoke `orc crown`, `orc verdict`, or any other follow-up Oraculum command even if the result suggests a next step; wait for explicit user instruction. Never invoke `orc crown` or `orc verdict` in the same response as `orc consult`; the user must send a separate follow-up command after this tool call finishes. If the tool fails or times out, report only the user-relevant failure and next step; do not mention AGENTS.md, skills, MCP, routing, or internal tool calls."
      : "Call the MCP tool immediately with no preamble. After the MCP tool succeeds, report only the user-relevant result concisely and stop. Do not run Bash, Edit, Write, or ad-hoc follow-up work unless the user explicitly asks. If the tool fails or times out, report only the user-relevant failure and next step; do not mention AGENTS.md, skills, MCP, routing, or internal tool calls.";

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
    postToolInstruction,
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
    case "plan":
      return [
        ...shared,
        "- `taskInput`: the first positional argument after removing recognized flags from the command",
        "- optional `--agent <claude-code|codex>`; default to `codex` when omitted",
        "- optional `--candidates <n>`",
        "- optional `--timeout-ms <ms>`",
        '- Example: `orc plan tasks/fix.md` -> `{ taskInput: "tasks/fix.md", agent: "codex" }`',
        '- Example: `orc plan tasks/fix.md --agent claude-code --candidates 2` -> `{ taskInput: "tasks/fix.md", agent: "claude-code", candidates: 2 }`',
      ];
    case "draft":
      return [
        ...shared,
        "- `taskInput`: the first positional argument after removing recognized flags from the command",
        "- optional `--agent <claude-code|codex>`; default to `codex` when omitted",
        "- optional `--candidates <n>`",
        "- optional `--timeout-ms <ms>`",
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
        "- optional `materializationName`: the first positional argument after `orc crown` when present; required only for branch materialization",
        "- omit `materializationName` when the user typed bare `orc crown`",
        "- compatibility note: the MCP request still accepts legacy `branchName`",
        "- in non-Git workspace-sync mode, Oraculum treats a provided `materializationName` value as a materialization label rather than a Git branch",
        "- the chat-native crowning path uses the recommended result automatically",
        '- Example: `orc crown fix/greet` -> `{ materializationName: "fix/greet" }`',
        "- Example: `orc crown` -> no materializationName field",
      ];
    case "init":
      return [...shared, "- optional `force`: parse the presence of `--force` as `true`"];
    default:
      return shared;
  }
}
