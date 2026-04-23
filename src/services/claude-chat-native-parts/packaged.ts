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
      ...shared,
      "Run: `oraculum orc consult $ARGUMENTS`.",
      "Args: optional taskInput=$ARGUMENTS. If empty, resume the latest running consultation first, otherwise execute the latest ready consultation plan. Do not parse planning flags.",
      "`orc consult` must never run `orc crown`; crown only when the user sends a separate `orc crown` input.",
    ];
  }

  if (entry.id === "plan") {
    return [
      ...shared,
      "Run: `oraculum orc plan $ARGUMENTS`.",
      "Args: taskInput=$ARGUMENTS only; do not parse planning flags. Clarification answers belong in the revised task text.",
    ];
  }

  if (entry.id === "crown") {
    return [
      ...shared,
      "Run: `oraculum orc crown $ARGUMENTS`.",
      "Args: optional first positional=materializationName; pass `--allow-unsafe` through when present.",
    ];
  }

  return [...shared, `Run: \`oraculum orc ${entry.path.join(" ")} $ARGUMENTS\`.`];
}

function buildClaudeRouteDescription(entry: CommandManifestEntry): string {
  return `orc ${entry.path.join(" ")}`;
}
