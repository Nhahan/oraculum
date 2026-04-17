import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandManifestEntry } from "../../domain/chat-native.js";
import {
  CLAUDE_MARKETPLACE_NAME,
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
      oraculum: {
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
  const claudePluginRootPlaceholder = "$" + "{CLAUDE_PLUGIN_ROOT}";

  return manifest
    .filter((entry) => entry.id !== "verdict-archive")
    .map((entry) => ({
      path: `commands/${entry.id}.md`,
      content: [
        "---",
        `description: "${entry.summary.replaceAll('"', '\\"')}"`,
        "---",
        "",
        "Read the file at `" +
          claudePluginRootPlaceholder +
          `/skills/${entry.id}/SKILL.md\` using the Read tool and follow its instructions exactly.`,
        "",
        "## User Input",
        "",
        "{{ARGUMENTS}}",
        "",
      ].join("\n"),
    }));
}

export function buildClaudeSkillFiles(
  manifest: readonly CommandManifestEntry[],
): Array<{ path: string; content: string }> {
  return manifest
    .filter((entry) =>
      new Set(["consult", "plan", "verdict", "crown", "draft", "init"]).has(entry.id),
    )
    .map((entry) => ({
      path: `.claude-plugin/skills/${entry.id}/SKILL.md`,
      content: renderClaudeSkill(entry),
    }));
}

function renderClaudeSkill(entry: CommandManifestEntry): string {
  const mcpArgs = buildClaudeSkillMcpArgs(entry);
  const magicPrefixes = entry.id === "crown" ? ["orc crown"] : [`orc ${entry.path.join(" ")}`];

  return [
    "---",
    `name: ${entry.id}`,
    `description: "${entry.summary.replaceAll('"', '\\"')}"`,
    `mcp_tool: ${entry.mcpTool}`,
    "mcp_args:",
    ...renderYamlObject(mcpArgs, 2),
    "magic_prefixes:",
    ...magicPrefixes.map((prefix) => `  - "${prefix}"`),
    "---",
    "",
    `# /oraculum:${entry.id}`,
    "",
    entry.summary,
    "",
    "## Usage",
    "",
    "```",
    ...buildUsageExamples(entry),
    "```",
    "",
    "## Notes",
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
      return { cwd: "$CWD", taskInput: "$ARGUMENTS", agent: "claude-code" };
    case "verdict":
      return { cwd: "$CWD", consultationId: "$1" };
    case "crown":
      return { cwd: "$CWD", materializationName: "$1", withReport: false };
    case "init":
      return { cwd: "$CWD", force: false };
    default:
      return { cwd: "$CWD" };
  }
}

function buildUsageExamples(entry: CommandManifestEntry): string[] {
  switch (entry.id) {
    case "crown":
      return ["orc crown fix/session-loss", "orc crown"];
    case "consult":
      return ['orc consult "fix session loss on refresh"'];
    case "plan":
      return ['orc plan "fix session loss on refresh"'];
    case "draft":
      return ['orc draft "fix session loss on refresh"'];
    case "verdict":
      return ["orc verdict", "orc verdict run_20260404_xxxx"];
    case "init":
      return ["orc init"];
    default:
      return entry.examples;
  }
}

function buildClaudeSkillNotes(entry: CommandManifestEntry): string[] {
  if (entry.id === "consult") {
    return [
      "- This skill is intended for exact-prefix routing inside Claude Code.",
      "- Call the MCP tool immediately with no preamble.",
      "- After the MCP tool returns, relay only the user-relevant result and stop.",
      "- Do not mention AGENTS.md, skills, MCP, routing, or internal tool calls.",
      "- Do not automatically invoke `orc crown`, `orc verdict`, or any other follow-up Oraculum command even if the result suggests a next step; wait for explicit user instruction.",
      "- Never invoke `orc crown` or `orc verdict` in the same response as `orc consult`; the user must send a separate follow-up command after this tool call finishes.",
      "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
    ];
  }

  if (entry.id === "plan") {
    return [
      "- This skill is intended for exact-prefix routing inside Claude Code.",
      "- Call the MCP tool immediately with no preamble.",
      "- After the MCP tool returns, relay only the user-relevant result and stop.",
      "- Do not mention AGENTS.md, skills, MCP, routing, or internal tool calls.",
      "- `orc plan` is the optional planning lane. It persists reusable consultation-plan artifacts but does not execute candidates.",
      "- Use `orc consult` later if the user wants to execute the planned consultation.",
      "- Do not automatically invoke `orc consult`, `orc crown`, or any other follow-up Oraculum command; wait for explicit user instruction.",
      "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
    ];
  }

  if (entry.id === "crown") {
    return [
      "- The first argument is required only when materializing onto a Git branch.",
      "- In non-Git workspace-sync mode, `orc crown` may omit the first argument; if one is present, Oraculum records it as a materialization label rather than a Git branch.",
      "- The MCP request also accepts `materializationName` as the canonical alias for the first crowning argument.",
      "- It crowns the recommended result from the latest eligible consultation and materializes it.",
      "- Call the MCP tool immediately with no preamble.",
      "- After the MCP tool succeeds, report only the verified materialization result and stop; do not re-apply the materialized result or run extra Bash, Edit, or Write steps unless the user explicitly asks.",
      "- Do not mention AGENTS.md, skills, MCP, routing, or internal tool calls.",
      "- The shared chat-native surface is `orc crown <branch-name>` for Git projects and `orc crown` for non-Git projects.",
      "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
    ];
  }

  return [
    "- This skill is intended for exact-prefix routing inside Claude Code.",
    "- Call the MCP tool immediately with no preamble.",
    "- After the MCP tool returns, relay only the user-relevant result and stop.",
    "- Do not mention AGENTS.md, skills, MCP, routing, or internal tool calls.",
    "- Do not automatically invoke another `orc ...` command based on suggested next steps; wait for explicit user instruction.",
    "- The Oraculum MCP server must already be registered through `oraculum setup --runtime claude-code`.",
  ];
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
