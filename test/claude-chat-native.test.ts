import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildClaudeCommandFiles,
  buildClaudeMarketplaceManifest,
  buildClaudePluginManifest,
  buildClaudePluginMcpConfig,
  buildClaudeSkillFiles,
  getPackagedClaudeCodeRoot,
  setupClaudeCodeHost,
} from "../src/services/claude-chat-native.js";

const tempRoots: string[] = [];

interface ClaudeMarketplaceManifestShape {
  name: string;
  plugins: Array<{
    source?: string;
  }>;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("Claude Code chat-native packaging", () => {
  it("generates marketplace, plugin, command, and skill artifacts from the shared manifest", () => {
    const marketplace =
      buildClaudeMarketplaceManifest() as unknown as ClaudeMarketplaceManifestShape;
    const plugin = buildClaudePluginManifest();
    const mcp = buildClaudePluginMcpConfig();
    const commands = buildClaudeCommandFiles(oraculumCommandManifest);
    const skills = buildClaudeSkillFiles(oraculumCommandManifest);

    expect(marketplace.name).toBe("oraculum");
    expect(marketplace.plugins[0]?.source).toBe("./.claude-plugin");
    expect(plugin.name).toBe("oraculum");
    expect(plugin.skills).toBe("./skills/");
    expect(mcp.mcpServers).toHaveProperty("oraculum");
    expect(
      (mcp.mcpServers as Record<string, { env?: Record<string, string> }>).oraculum?.env
        ?.ORACULUM_AGENT_RUNTIME,
    ).toBe("claude-code");

    expect(commands.map((file) => file.path)).toEqual([
      "commands/consult.md",
      "commands/verdict.md",
      "commands/crown.md",
      "commands/draft.md",
      "commands/init.md",
    ]);
    expect(skills.map((file) => file.path)).toEqual([
      ".claude-plugin/skills/consult/SKILL.md",
      ".claude-plugin/skills/verdict/SKILL.md",
      ".claude-plugin/skills/crown/SKILL.md",
      ".claude-plugin/skills/draft/SKILL.md",
      ".claude-plugin/skills/init/SKILL.md",
    ]);

    const crownSkill = skills.find((file) => file.path.includes("/crown/"));
    expect(crownSkill?.content).toContain("mcp_tool: oraculum_crown");
    expect(crownSkill?.content).toContain('branchName: "$1"');
    expect(crownSkill?.content).toContain(
      "- The first argument is required only when crowning a Git-backed candidate onto a new branch.",
    );
    expect(crownSkill?.content).toContain("`orc crown` for non-Git projects");
    expect(crownSkill?.content).toContain(
      "After the MCP tool succeeds, report the verified materialization result and stop",
    );

    const consultSkill = skills.find((file) => file.path.includes("/consult/"));
    expect(consultSkill?.content).toContain('taskInput: "$ARGUMENTS"');
    expect(consultSkill?.content).toContain('agent: "claude-code"');
    expect(consultSkill?.content).toContain("do not replace the next Oraculum command");
  });

  it("writes packaged Claude artifacts into dist during the build", async () => {
    const packagedRoot = getPackagedClaudeCodeRoot();
    expect(packagedRoot.replaceAll("\\", "/")).toContain("/dist/chat-native/claude-code");
  });

  it("keeps the marketplace source path aligned with the packaged plugin root", () => {
    const marketplace =
      buildClaudeMarketplaceManifest() as unknown as ClaudeMarketplaceManifestShape;
    const pluginSource = marketplace.plugins[0]?.source;

    expect(pluginSource).toBe("./.claude-plugin");
  });
});

describe("Claude Code setup", () => {
  it("merges MCP config and installs the packaged plugin through the Claude CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-claude-setup-"));
    tempRoots.push(root);
    const homeDir = join(root, "home");
    const statePath = join(root, "fake-claude-state.json");
    const cliPath = join(root, "fake-claude.mjs");
    const packagedRoot = join(root, "packaged-claude");
    await mkdir(join(packagedRoot, ".claude-plugin"), { recursive: true });
    await writeFile(join(packagedRoot, ".claude-plugin", "marketplace.json"), "{}\n", "utf8");
    await writeFile(join(packagedRoot, ".claude-plugin", "plugin.json"), "{}\n", "utf8");

    await writeFile(
      cliPath,
      [
        "import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { dirname } from 'node:path';",
        "const statePath = process.env.ORACULUM_FAKE_CLAUDE_STATE;",
        "if (!statePath) process.exit(11);",
        "const args = process.argv.slice(2);",
        "const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: [], plugins: [] };",
        "const writeState = (value) => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(value)); };",
        "const state = readState();",
        "if (args[0] === 'plugin' && args[1] === 'validate') { process.stdout.write('ok\\n'); process.exit(0); }",
        "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list' && args[3] === '--json') { process.stdout.write(JSON.stringify(state.marketplaces)); process.exit(0); }",
        "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { state.marketplaces.push({ name: 'oraculum' }); writeState(state); process.exit(0); }",
        "if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') { process.stdout.write(JSON.stringify(state.plugins)); process.exit(0); }",
        "if (args[0] === 'plugin' && args[1] === 'install') { state.plugins.push({ name: 'oraculum' }); writeState(state); process.exit(0); }",
        "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
      ].join("\n"),
      "utf8",
    );

    const result = await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
      },
      homeDir,
      packagedRoot,
      scope: "local",
    });

    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers: Record<string, { args: string[]; command: string; env?: Record<string, string> }>;
    };
    const effectivePluginMcpConfig = JSON.parse(
      await readFile(result.effectiveMcpConfigPath, "utf8"),
    ) as {
      mcpServers: Record<string, { args: string[]; command: string; env?: Record<string, string> }>;
    };
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      marketplaces: Array<{ name: string }>;
      plugins: Array<{ name: string }>;
    };

    expect(mcpConfig.mcpServers.oraculum?.command).toBe(process.execPath);
    expect(mcpConfig.mcpServers.oraculum?.args.at(-2)).toBe("mcp");
    expect(mcpConfig.mcpServers.oraculum?.args.at(-1)).toBe("serve");
    expect(mcpConfig.mcpServers.oraculum?.env?.ORACULUM_AGENT_RUNTIME).toBe("claude-code");
    expect(effectivePluginMcpConfig.mcpServers.oraculum?.args.at(-2)).toBe("mcp");
    expect(effectivePluginMcpConfig.mcpServers.oraculum?.args.at(-1)).toBe("serve");
    expect(effectivePluginMcpConfig.mcpServers.oraculum?.env?.ORACULUM_AGENT_RUNTIME).toBe(
      "claude-code",
    );
    expect(result.installRoot).toContain(".oraculum");
    expect(state.marketplaces).toEqual([{ name: "oraculum" }]);
    expect(state.plugins).toEqual([{ name: "oraculum" }]);
    expect(result.pluginInstalled).toBe(true);
  });
});
