import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandManifestEntry } from "../../domain/chat-native.js";
import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_MCP_SERVER_NAME,
  CLAUDE_MCP_TIMEOUT_SECONDS,
  CLAUDE_PLUGIN_NAME,
  CLAUDE_PLUGIN_VERSION,
} from "./shared.js";

export function getPackagedClaudeCodeRoot(): string {
  return fileURLToPath(new URL("../../../dist/chat-native/claude-code", import.meta.url));
}

export function getPackagedClaudePluginRoot(): string {
  return join(getPackagedClaudeCodeRoot(), ".claude-plugin");
}

export function getPackagedClaudeMarketplacePath(): string {
  return join(getPackagedClaudePluginRoot(), "marketplace.json");
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
        keywords: ["oraculum", "consultation", "verdict", "crowning", "mcp"],
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
    keywords: ["oraculum", "consultation", "verdict", "crowning", "mcp"],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  };
}

export function buildClaudePluginMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        command: process.platform === "win32" ? "oraculum.cmd" : "oraculum",
        args: ["mcp", "serve"],
        env: {
          ORACULUM_AGENT_RUNTIME: "claude-code",
          ORACULUM_LLM_BACKEND: "claude-code",
        },
        timeout: CLAUDE_MCP_TIMEOUT_SECONDS,
      },
    },
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
    .filter((entry) =>
      new Set(["consult", "plan", "verdict", "verdict-archive", "crown", "draft", "init"]).has(
        entry.id,
      ),
    )
    .map((entry) => ({
      path: `.claude-plugin/skills/${entry.id}/SKILL.md`,
      content: renderClaudeSkill(entry),
    }));
}

export function getExpectedClaudeSkillDirs(): string[] {
  return ["consult", "plan", "verdict", "verdict-archive", "crown", "draft", "init"];
}

export function getExpectedClaudeCommandFiles(): string[] {
  return [
    "commands/consult.md",
    "commands/verdict.md",
    "commands/verdict-archive.md",
    "commands/crown.md",
    "commands/plan.md",
    "commands/draft.md",
    "commands/init.md",
  ];
}

function renderClaudeSkill(entry: CommandManifestEntry): string {
  const mcpArgs = buildClaudeSkillMcpArgs(entry);
  const magicPrefixes = entry.id === "crown" ? ["orc crown"] : [`orc ${entry.path.join(" ")}`];

  return [
    "---",
    `name: ${entry.id}`,
    `description: "${buildClaudeRouteDescription(entry).replaceAll('"', '\\"')}"`,
    `mcp_tool: ${entry.mcpTool}`,
    "mcp_args:",
    ...renderYamlObject(mcpArgs, 2),
    "magic_prefixes:",
    ...magicPrefixes.map((prefix) => `  - "${prefix}"`),
    "---",
    "",
    ...buildClaudeSkillNotes(entry),
    "",
  ].join("\n");
}

function buildClaudeSkillMcpArgs(entry: CommandManifestEntry): Record<string, unknown> {
  switch (entry.id) {
    case "consult":
    case "plan":
    case "draft":
      return { cwd: "$CWD", taskInput: "$ARGUMENTS" };
    case "verdict":
      return { cwd: "$CWD", consultationId: "$1" };
    case "verdict-archive":
      return { cwd: "$CWD", count: "$1" };
    case "crown":
      return { cwd: "$CWD", materializationName: "$1", withReport: false, allowUnsafe: false };
    case "init":
      return { cwd: "$CWD", force: false };
    default:
      return { cwd: "$CWD" };
  }
}

function renderClaudeCommand(entry: CommandManifestEntry): string {
  return [
    "---",
    `description: "${buildClaudeRouteDescription(entry).replaceAll('"', '\\"')}"`,
    "---",
    "",
    "MCP only.",
    `Tool: \`${entry.mcpTool}\``,
    "Before MCP: no user text, no file reads, no shell.",
    "After MCP: return only the user-relevant result or failure.",
    "",
    "## User Input",
    "",
    "{{ARGUMENTS}}",
    "",
  ].join("\n");
}

function buildClaudeSkillNotes(entry: CommandManifestEntry): string[] {
  const shared = [
    "MCP only.",
    "Before MCP: no user text, no file reads, no shell.",
    "After MCP: return only the user-relevant result or failure.",
  ];

  if (entry.id === "consult") {
    return [
      ...shared,
      "Tool: `oraculum_consult`.",
      "Args: cwd=current-directory; taskInput=$ARGUMENTS only; do not parse planning flags. Advanced planning controls live in config or the task contract.",
    ];
  }

  if (entry.id === "plan") {
    return [
      ...shared,
      "Tool: `oraculum_plan`.",
      "Args: cwd=current-directory; taskInput=$ARGUMENTS only; do not parse planning flags. Clarification answers belong in the revised task text.",
    ];
  }

  if (entry.id === "draft") {
    return [
      ...shared,
      "Tool: `oraculum_draft`.",
      "Args: cwd=current-directory; taskInput=$ARGUMENTS only; do not parse planning flags. Clarification answers belong in the revised task text.",
    ];
  }

  if (entry.id === "verdict-archive") {
    return [
      ...shared,
      "Tool: `oraculum_verdict_archive`.",
      "Args: cwd=current-directory; optional first positional=count.",
    ];
  }

  if (entry.id === "crown") {
    return [
      ...shared,
      "Tool: `oraculum_crown`.",
      "Args: cwd=current-directory; optional first positional=materializationName; `orc crown --allow-unsafe` maps to allowUnsafe=true on official host routes.",
    ];
  }

  return [...shared, `Tool: \`${entry.mcpTool}\`.`];
}

function buildClaudeRouteDescription(entry: CommandManifestEntry): string {
  return `orc ${entry.path.join(" ")}`;
}

function renderYamlObject(value: Record<string, unknown>, indent: number): string[] {
  const prefix = " ".repeat(indent);
  return Object.entries(value).map(([key, entry]) => {
    if (typeof entry === "string") {
      return `${prefix}${key}: "${entry.replaceAll('"', '\\"')}"`;
    }

    return `${prefix}${key}: ${String(entry)}`;
  });
}
