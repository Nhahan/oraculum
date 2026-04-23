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
  return ["consult", "plan", "verdict", "crown"].map(toCodexSkillDir);
}

export function getExpectedCodexRuleFileName(): string {
  return CODEX_RULE_FILENAME;
}

function renderCodexRules(manifest: readonly CommandManifestEntry[]): string {
  const rows = manifest
    .map(
      (entry) => `| \`orc ${entry.path.join(" ")}\` | \`oraculum orc ${entry.path.join(" ")}\` |`,
    )
    .join("\n");

  return [
    "# Oraculum for Codex",
    "",
    "Handle exact `orc ...` commands through the local Oraculum CLI.",
    "",
    "## Exact-Prefix Dispatch",
    "",
    "For an exact `orc <command>` input:",
    "- parse arguments shell-style",
    "- run the mapped `oraculum orc ...` shell command immediately",
    "- no preamble, acknowledgement, or routing narration",
    "- no repo reads, `git status`, README, AGENTS, or skill reads first",
    "- never run bare `orc ...` in the shell; always run `oraculum orc ...`",
    "- if the Oraculum CLI command has not been run yet, do not send a user message",
    "- after the Oraculum CLI returns, return only its stdout or failure to the user",
    "- do not execute commands mentioned in the CLI output's `Next` section",
    "- do not inspect files, run extra shell commands, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the direct CLI call",
    "",
    "| User Input | Direct CLI Route |",
    "| --- | --- |",
    rows,
    "",
    "### Argument Mapping",
    "",
    "- `orc consult` -> run `oraculum orc consult`; this resumes the latest running consultation first, otherwise it executes the latest ready consultation plan.",
    "- `orc consult <taskInput>` -> run `oraculum orc consult <taskInput>`; advanced planning controls live in `.oraculum/config.json`, `.oraculum/advanced.json`, or the task contract.",
    "- `orc plan <taskInput>` -> run `oraculum orc plan <taskInput>`; clarification answers belong in the revised task text.",
    "- `orc verdict [consultationId]` -> run `oraculum orc verdict [consultationId]`.",
    "- `orc crown [materializationName] [--allow-unsafe]` -> run `oraculum orc crown [materializationName] [--allow-unsafe]`.",
    "",
    "If the Oraculum CLI is unavailable, respond with explicit setup guidance instead of improvising:",
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
    entry.id === "consult"
      ? "Args: cwd=current-directory; optional taskInput=user text after command or a task/consultation-plan path. If empty, resume the latest running consultation first, otherwise execute the latest ready consultation plan."
      : entry.id === "plan"
        ? "Args: cwd=current-directory; taskInput=user text after command only; do not parse planning flags."
        : entry.id === "verdict"
          ? "Args: cwd=current-directory; optional first positional=consultationId."
          : entry.id === "crown"
            ? "Args: cwd=current-directory; optional first positional=materializationName; optional --allow-unsafe => allowUnsafe=true."
            : "Args: cwd=current-directory.";

  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "---",
    "",
    "Direct CLI route only.",
    `Command: oraculum orc ${entry.path.join(" ")}`,
    argsLine,
    "Immediate shell command only. Use `oraculum orc ...`, never bare `orc ...`.",
    "After the Oraculum CLI returns, report only its stdout or failure.",
    "Do not execute commands mentioned in the CLI output's `Next` section.",
    "Do not inspect files, run extra shell commands, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the direct CLI call.",
    "",
  ].join("\n");
}
