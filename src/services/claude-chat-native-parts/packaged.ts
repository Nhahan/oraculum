import { fileURLToPath } from "node:url";

import type { CommandManifestEntry } from "../../domain/chat-native.js";
import { CLAUDE_MARKETPLACE_NAME, CLAUDE_PLUGIN_NAME, CLAUDE_PLUGIN_VERSION } from "./shared.js";

export function getPackagedClaudeCodeRoot(): string {
  return fileURLToPath(new URL("../../../dist/chat-native/claude-code", import.meta.url));
}

export function buildClaudeMarketplaceManifest(): Record<string, unknown> {
  return {
    name: CLAUDE_MARKETPLACE_NAME,
    owner: {
      name: "Nhahan",
      email: "kisy324@naver.com",
    },
    plugins: [
      {
        name: CLAUDE_PLUGIN_NAME,
        description:
          "Consult competing candidates, read verdicts, and crown recommended results with Oraculum.",
        version: CLAUDE_PLUGIN_VERSION,
        author: {
          name: "Nhahan",
          email: "kisy324@naver.com",
        },
        source: "./.claude-plugin",
        category: "development",
        homepage: "https://github.com/Nhahan/oraculum",
        repository: "https://github.com/Nhahan/oraculum",
        license: "MIT",
        keywords: ["oraculum", "consultation", "verdict", "crowning"],
        tags: ["candidate-consultation", "oracle-guided", "development"],
      },
    ],
  };
}

export function buildClaudePluginManifest(): Record<string, unknown> {
  return {
    name: CLAUDE_PLUGIN_NAME,
    version: CLAUDE_PLUGIN_VERSION,
    description:
      "Consult competing candidates, read verdicts, and crown recommended results with Oraculum.",
    author: {
      name: "Nhahan",
      email: "kisy324@naver.com",
    },
    repository: "https://github.com/Nhahan/oraculum",
    homepage: "https://github.com/Nhahan/oraculum",
    license: "MIT",
    keywords: ["oraculum", "consultation", "verdict", "crowning"],
    skills: "./skills/",
  };
}

export function buildClaudeCommandFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return manifest.map((entry) => ({
    path: `commands/${entry.id}.md`,
    content: renderClaudeCommand(entry),
  }));
}

export function buildClaudeSkillFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return manifest
    .filter((entry) => new Set(["consult", "plan", "verdict", "crown"]).has(entry.id))
    .map((entry) => ({
      path: `.claude-plugin/skills/${entry.id}/SKILL.md`,
      content: renderClaudeSkill(entry),
    }));
}

export function getExpectedClaudeSkillDirs(): string[] {
  return ["consult", "plan", "verdict", "crown"];
}

export function getExpectedClaudeCommandFiles(): string[] {
  return ["commands/consult.md", "commands/plan.md", "commands/verdict.md", "commands/crown.md"];
}

function renderClaudeSkill(entry: CommandManifestEntry): string {
  const magicPrefixes = entry.id === "crown" ? ["orc crown"] : [`orc ${entry.path.join(" ")}`];

  return [
    "---",
    `name: ${entry.id}`,
    `description: "${buildClaudeRouteDescription(entry).replaceAll('"', '\\"')}"`,
    "magic_prefixes:",
    ...magicPrefixes.map((prefix) => `  - "${prefix}"`),
    "---",
    "",
    ...buildClaudeSkillNotes(entry),
    "",
  ].join("\n");
}

function renderClaudeCommand(entry: CommandManifestEntry): string {
  if (isUserInteractionRoute(entry)) {
    return [
      "---",
      `description: "${buildClaudeRouteDescription(entry).replaceAll('"', '\\"')}"`,
      "---",
      "",
      "Host-guided interactive Oraculum route.",
      `Run \`oraculum orc ${entry.path.join(" ")} --json {{ARGUMENTS}}\` as the initial shell command.`,
      "If the JSON response includes `userInteraction` and `userInteraction.options` is present, call `AskUserQuestion` with one question, header `userInteraction.header`, `multiSelect=false`, `userInteraction.question` as the prompt, and only those exact choices.",
      "If `userInteraction.options` is absent, do not call `AskUserQuestion`; ask the user for one normal free-text reply using `userInteraction.question`, then stop until the user replies. Do not invent placeholder choices such as `Provide custom string`, `Skip / cancel`, `Type something`, or branch-name suggestions.",
      "Allow custom text because `userInteraction.freeTextAllowed` is true, then run `oraculum orc answer --json <userInteraction.kind> <userInteraction.runId> <answer>` with the selected option label or the user's literal custom text. Never pass UI sentinels such as `__other__` or placeholder choice labels as the answer.",
      "`apply-approval` is the apply gate; ask it exactly like other `userInteraction` prompts. `orc consult --defer` suppresses this gate so the user can run `orc crown` manually later.",
      "Repeat until `userInteraction` is absent, then return the final response summary or crown materialization result. Do not execute commands mentioned in `Next`.",
      "Do not inspect files, edit files, apply candidate changes, clean the worktree, or continue the task yourself.",
      "",
      "## User Input",
      "",
      "{{ARGUMENTS}}",
      "",
    ].join("\n");
  }

  return [
    "---",
    `description: "${buildClaudeRouteDescription(entry).replaceAll('"', '\\"')}"`,
    "---",
    "",
    "Direct CLI only.",
    `Run exactly one shell command: \`oraculum orc ${entry.path.join(" ")} {{ARGUMENTS}}\`.`,
    "Before the command: no user text, no file reads, no extra shell.",
    "After the command: return only the command stdout or failure.",
    "Do not execute commands mentioned in the CLI output's `Next` section.",
    "Do not inspect files, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the direct CLI call.",
    "",
    "## User Input",
    "",
    "{{ARGUMENTS}}",
    "",
  ].join("\n");
}

function buildClaudeSkillNotes(entry: CommandManifestEntry): string[] {
  const shared = [
    "Direct CLI only.",
    "Before the command: no user text, no file reads, no extra shell.",
    "After the command: return only the command stdout or failure.",
    "Do not execute commands mentioned in the CLI output's `Next` section.",
    "Do not inspect files, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the direct CLI call.",
  ];

  if (entry.id === "consult") {
    return [
      ...buildClaudeUserInteractionRouteNotes(entry),
      "Args: optional --defer passes through to `oraculum orc consult --json --defer`; optional taskInput=$ARGUMENTS. If empty, resume the latest running consultation first, otherwise execute the latest ready consultation plan.",
      "`orc consult` may ask `apply-approval` after an eligible verdict; answer it through `oraculum orc answer --json apply-approval <runId> <answer>`. `orc consult --defer` keeps the manual `orc crown` flow.",
    ];
  }

  if (entry.id === "plan") {
    return [
      ...buildClaudeUserInteractionRouteNotes(entry),
      "Args: taskInput=$ARGUMENTS only; do not parse planning flags.",
    ];
  }

  if (entry.id === "crown") {
    return [
      ...shared,
      "Run: `oraculum orc crown $ARGUMENTS`.",
      "Args: optional first positional=materializationName label; pass `--branch <branchName>` and `--allow-unsafe` through when present. Omit `--branch` for the default direct apply into the current workspace.",
    ];
  }

  if (entry.id === "verdict") {
    return [
      ...buildClaudeUserInteractionRouteNotes(entry),
      "Args: optional first positional=consultationId.",
    ];
  }

  return [...shared, `Run: \`oraculum orc ${entry.path.join(" ")} $ARGUMENTS\`.`];
}

function buildClaudeRouteDescription(entry: CommandManifestEntry): string {
  return `orc ${entry.path.join(" ")}`;
}

function buildClaudeUserInteractionRouteNotes(entry: CommandManifestEntry): string[] {
  return [
    "Direct CLI only.",
    "Use one direct CLI call for each interaction hop.",
    "Before each CLI command: no user text, no file reads, no extra shell.",
    `Run first: \`oraculum orc ${entry.path.join(" ")} --json $ARGUMENTS\`.`,
    "If JSON includes `userInteraction` and `userInteraction.options` is present, call `AskUserQuestion` with one question, header `userInteraction.header`, `multiSelect=false`, `userInteraction.question` as the prompt, and only those exact choices.",
    "If `userInteraction.options` is absent, do not call `AskUserQuestion`; ask the user for one normal free-text reply using `userInteraction.question`, then stop until the user replies. Do not invent placeholder choices such as `Provide custom string`, `Skip / cancel`, `Type something`, or branch-name suggestions.",
    "Allow custom text because `userInteraction.freeTextAllowed` is true, then pass the selected option label or the user's literal custom text to `oraculum orc answer --json <userInteraction.kind> <userInteraction.runId> <answer>`. Never pass UI sentinels such as `__other__` or placeholder choice labels as the answer.",
    "`apply-approval` is the apply gate; ask it exactly like other `userInteraction` prompts. `orc consult --defer` suppresses this gate so the user can run `orc crown` manually later.",
    "Repeat the same JSON loop until `userInteraction` is absent.",
    "After the final CLI call, return only the final summary, crown materialization result, or failure.",
    "Do not execute commands mentioned in the CLI output's `Next` section.",
    "Do not inspect files, edit files, apply candidate changes, clean the worktree, or continue the task yourself after the final CLI call.",
  ];
}

function isUserInteractionRoute(entry: CommandManifestEntry): boolean {
  return entry.id === "consult" || entry.id === "plan" || entry.id === "verdict";
}
