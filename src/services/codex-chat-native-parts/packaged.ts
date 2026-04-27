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
    "- `orc consult` -> run `oraculum orc consult --json`; this resumes the latest running consultation first, otherwise it executes the latest ready consultation plan. If JSON includes `userInteraction`, run the structured answer loop below; eligible winners may surface `apply-approval` so the host asks before materializing.",
    "- `orc consult --defer [taskInput]` -> pass `--defer` through to `oraculum orc consult --json --defer [taskInput]`; this keeps the verdict-only/manual `orc crown` flow and must not ask `apply-approval`.",
    "- `orc consult <taskInput>` -> run `oraculum orc consult --json <taskInput>`; advanced planning controls live in `.oraculum/config.json`, `.oraculum/advanced.json`, or the task contract. If JSON includes `userInteraction`, run the structured answer loop below.",
    "- `orc plan <taskInput>` -> run `oraculum orc plan --json <taskInput>`; if JSON includes `userInteraction`, run the structured answer loop below.",
    "- `orc verdict [consultationId]` -> run `oraculum orc verdict --json [consultationId]`; if JSON includes `userInteraction`, run the structured answer loop below.",
    "- `orc crown [materializationName] [--allow-unsafe]` -> run `oraculum orc crown [materializationName] [--allow-unsafe]`.",
    "- Structured answer loop: ask exactly one Codex structured user-input question using `userInteraction.header` as the header and `userInteraction.question` as the prompt. Use choices only when `userInteraction.options` is present, and include only those exact choices. If `userInteraction.options` is absent, ask an open free-text question with no choices. Pass the selected option label or the user's literal custom text to `oraculum orc answer --json <userInteraction.kind> <userInteraction.runId> <answer>`. Never pass UI sentinels such as `__other__` or placeholder choice labels as the answer. Repeat until `userInteraction` is absent, then report only the final summary, crown materialization result, or failure.",
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
  const interactiveRoute = isUserInteractionRoute(entry);
  const skillName = entry.id === "consult" ? "task" : entry.id;
  const description =
    entry.id === "consult"
      ? "Primary task route."
      : `Exact \`orc ${entry.path.join(" ")}\` handler.`;
  const argsLine =
    entry.id === "consult"
      ? "Args: cwd=current-directory; optional --defer => deferApply=true; optional taskInput=user text after command or a task/consultation-plan path. If empty, resume the latest running consultation first, otherwise execute the latest ready consultation plan."
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
    interactiveRoute ? "Host-guided direct CLI route." : "Direct CLI route only.",
    `Command: oraculum orc ${entry.path.join(" ")}${interactiveRoute ? " --json" : ""}`,
    argsLine,
    "Immediate shell command only. Use `oraculum orc ...`, never bare `orc ...`.",
    ...(interactiveRoute
      ? [
          `Run first: \`oraculum orc ${entry.path.join(" ")} --json $ARGUMENTS\`.`,
          "If the JSON response includes `userInteraction`, ask exactly one structured user-input question when that UI is available.",
          "Use `userInteraction.header` as the header and `userInteraction.question` as the prompt.",
          "Use choices only when `userInteraction.options` is present, and include only those exact choices. If `userInteraction.options` is absent, ask an open free-text question with no choices.",
          "Pass the selected option label or the user's literal custom text to `oraculum orc answer --json <userInteraction.kind> <userInteraction.runId> <answer>`. Never pass UI sentinels such as `__other__` or placeholder choice labels as the answer.",
          "`apply-approval` is the apply gate; ask it exactly like other `userInteraction` prompts. `orc consult --defer` suppresses this gate so the user can run `orc crown` manually later.",
          "Repeat until `userInteraction` is absent; then report only the final summary, crown materialization result, or failure.",
        ]
      : []),
    interactiveRoute
      ? "After the final Oraculum CLI call returns, report only its stdout summary, crown materialization result, or failure."
      : "After the Oraculum CLI returns, report only its stdout or failure.",
    "Do not execute commands mentioned in the CLI output's `Next` section.",
    "Do not inspect files, run extra shell commands, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the direct CLI call.",
    "",
  ].join("\n");
}

function isUserInteractionRoute(entry: CommandManifestEntry): boolean {
  return entry.id === "consult" || entry.id === "plan" || entry.id === "verdict";
}
