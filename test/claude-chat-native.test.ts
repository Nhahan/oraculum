import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/core/constants.js";
import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildClaudeCommandFiles,
  buildClaudeMarketplaceManifest,
  buildClaudePluginManifest,
  buildClaudePluginMcpConfig,
  buildClaudeSkillFiles,
  getPackagedClaudeCodeRoot,
  setupClaudeCodeHost,
  uninstallClaudeCodeHost,
} from "../src/services/claude-chat-native.js";

const tempRoots: string[] = [];

interface ClaudeMarketplaceManifestShape {
  name: string;
  plugins: Array<{
    source?: string;
  }>;
}

interface FakeClaudeState {
  marketplaces: Array<{
    installLocation?: string;
    name: string;
    path?: string;
    source?: string;
  }>;
  ops: string[];
  plugins: Array<{
    id: string;
    installPath?: string;
    name?: string;
    version?: string;
  }>;
}

function normalizePathValue(value: string | undefined): string | undefined {
  return value?.replaceAll("\\", "/");
}

function normalizePluginInstallPaths(
  plugins: FakeClaudeState["plugins"],
): FakeClaudeState["plugins"] {
  return plugins.map((plugin) => {
    const normalized: FakeClaudeState["plugins"][number] = { ...plugin };
    if (plugin.installPath) {
      normalized.installPath = normalizePathValue(plugin.installPath)!;
    }
    return normalized;
  });
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createFakeClaudeSetupFixture(initialState?: Partial<FakeClaudeState>) {
  const root = await mkdtemp(join(tmpdir(), "oraculum-claude-setup-"));
  tempRoots.push(root);
  const homeDir = join(root, "home");
  const statePath = join(root, "fake-claude-state.json");
  const cliPath = join(root, "fake-claude.mjs");
  const packagedRoot = join(root, "packaged-claude");
  await mkdir(join(packagedRoot, ".claude-plugin"), { recursive: true });
  await writeFile(join(packagedRoot, ".claude-plugin", "marketplace.json"), "{}\n", "utf8");
  await writeFile(join(packagedRoot, ".claude-plugin", "plugin.json"), "{}\n", "utf8");

  const state: FakeClaudeState = {
    marketplaces: initialState?.marketplaces ?? [],
    ops: initialState?.ops ?? [],
    plugins: initialState?.plugins ?? [],
  };
  await writeFile(statePath, JSON.stringify(state), "utf8");

  await writeFile(
    cliPath,
    [
      "import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "const statePath = process.env.ORACULUM_FAKE_CLAUDE_STATE;",
      "const pluginVersion = process.env.ORACULUM_FAKE_PLUGIN_VERSION;",
      "if (!statePath || !pluginVersion) process.exit(11);",
      "const args = process.argv.slice(2);",
      "const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: [], plugins: [], ops: [] };",
      "const writeState = (value) => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(value)); };",
      "const state = readState();",
      "state.ops ??= [];",
      "const save = () => writeState(state);",
      "if (args[0] === 'plugin' && args[1] === 'validate') { state.ops.push('plugin validate'); save(); process.stdout.write('ok\\n'); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list' && args[3] === '--json') { process.stdout.write(JSON.stringify(state.marketplaces)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { const source = args[3]; state.marketplaces = state.marketplaces.filter((entry) => entry.name !== 'oraculum'); state.marketplaces.push({ name: 'oraculum', source: 'directory', path: source, installLocation: source }); state.ops.push('marketplace add ' + source); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') { const name = args[3]; state.marketplaces = state.marketplaces.filter((entry) => entry.name !== name); state.ops.push('marketplace remove ' + name); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') { process.stdout.write(JSON.stringify(state.plugins)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'install') { const pluginRef = args[2]; const [name, marketplaceName = 'default'] = pluginRef.split('@'); state.plugins = state.plugins.filter((entry) => (entry.name ?? entry.id.split('@')[0]) !== name); state.plugins.push({ id: name + '@' + marketplaceName, name, version: pluginVersion, installPath: join('/fake-cache', marketplaceName, name, pluginVersion) }); state.ops.push('plugin install ' + name); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'uninstall') { const name = args[2]; state.plugins = state.plugins.filter((entry) => (entry.name ?? entry.id.split('@')[0]) !== name); state.ops.push('plugin uninstall ' + name); save(); process.exit(0); }",
      "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
    ].join("\n"),
    "utf8",
  );

  return { cliPath, homeDir, packagedRoot, statePath };
}

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
    const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();

    const result = await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
      packagedRoot,
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
      marketplaces: Array<{
        installLocation?: string;
        name: string;
        path?: string;
        source?: string;
      }>;
      ops: string[];
      plugins: Array<{ id: string; name?: string; version?: string }>;
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
    expect(state.marketplaces).toEqual([
      {
        installLocation: result.installRoot,
        name: "oraculum",
        path: result.installRoot,
        source: "directory",
      },
    ]);
    expect(normalizePluginInstallPaths(state.plugins)).toEqual([
      {
        id: "oraculum@oraculum",
        installPath: `/fake-cache/oraculum/oraculum/${APP_VERSION}`,
        name: "oraculum",
        version: APP_VERSION,
      },
    ]);
    expect(state.ops).toEqual([
      "plugin validate",
      `marketplace add ${result.installRoot}`,
      "plugin install oraculum",
    ]);
    expect(result.pluginInstalled).toBe(true);
  });

  it("replaces stale Claude marketplace and plugin installs when their path or version drifts", async () => {
    const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
    const staleState: FakeClaudeState = {
      marketplaces: [
        {
          installLocation: join(homeDir, ".oraculum", "chat-native", "claude-code", "0.1.0-beta.5"),
          name: "oraculum",
          path: join(homeDir, ".oraculum", "chat-native", "claude-code", "0.1.0-beta.5"),
          source: "directory",
        },
      ],
      ops: [],
      plugins: [
        {
          id: "oraculum@oraculum",
          installPath: "/fake-cache/oraculum/oraculum/0.1.0-beta.5",
          name: "oraculum",
          version: "0.1.0-beta.5",
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(staleState), "utf8");

    const result = await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
      packagedRoot,
    });

    const state = JSON.parse(await readFile(statePath, "utf8")) as FakeClaudeState;

    expect(state.marketplaces).toEqual([
      {
        installLocation: result.installRoot,
        name: "oraculum",
        path: result.installRoot,
        source: "directory",
      },
    ]);
    expect(normalizePluginInstallPaths(state.plugins)).toEqual([
      {
        id: "oraculum@oraculum",
        installPath: `/fake-cache/oraculum/oraculum/${APP_VERSION}`,
        name: "oraculum",
        version: APP_VERSION,
      },
    ]);
    expect(state.ops).toEqual([
      "plugin validate",
      "marketplace remove oraculum",
      `marketplace add ${result.installRoot}`,
      "plugin uninstall oraculum",
      "plugin install oraculum",
    ]);
  });

  it("keeps an already aligned Claude marketplace and plugin install untouched", async () => {
    const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
    const alignedState: FakeClaudeState = {
      marketplaces: [
        {
          installLocation: join(homeDir, ".oraculum", "chat-native", "claude-code", APP_VERSION),
          name: "oraculum",
          path: join(homeDir, ".oraculum", "chat-native", "claude-code", APP_VERSION),
          source: "directory",
        },
      ],
      ops: [],
      plugins: [
        {
          id: "oraculum@oraculum",
          installPath: `/fake-cache/oraculum/oraculum/${APP_VERSION}`,
          name: "oraculum",
          version: APP_VERSION,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(alignedState), "utf8");

    await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
      packagedRoot,
    });

    const state = JSON.parse(await readFile(statePath, "utf8")) as FakeClaudeState;
    expect(state.ops).toEqual(["plugin validate"]);
  });

  it("uninstalls Claude marketplace/plugin wiring and removes the MCP entry", async () => {
    const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
    await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
      packagedRoot,
    });
    await writeFile(
      join(homeDir, ".claude", "mcp.json"),
      `${JSON.stringify(
        {
          mcpServers: {
            other: { command: "echo", args: ["ok"] },
            oraculum: { command: "node", args: ["cli.js", "mcp", "serve"] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await uninstallClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
    });

    const state = JSON.parse(await readFile(statePath, "utf8")) as FakeClaudeState;
    const mcpConfig = JSON.parse(await readFile(result.mcpConfigPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };

    expect(result.marketplaceRemoved).toBe(true);
    expect(result.pluginRemoved).toBe(true);
    expect(state.marketplaces).toEqual([]);
    expect(state.plugins).toEqual([]);
    expect(state.ops.at(-2)).toBe("marketplace remove oraculum");
    expect(state.ops.at(-1)).toBe("plugin uninstall oraculum");
    expect(mcpConfig.mcpServers).toEqual({
      other: { command: "echo", args: ["ok"] },
    });
  });
});
