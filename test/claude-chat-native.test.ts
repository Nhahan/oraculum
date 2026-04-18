import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
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
import { createTempRootHarness } from "./helpers/fs.js";
import { HOST_SETUP_TEST_TIMEOUT_MS } from "./helpers/integration.js";

const tempRootHarness = createTempRootHarness("oraculum-claude-setup-");
tempRootHarness.registerCleanup();

interface ClaudeMarketplaceManifestShape {
  name: string;
  plugins: Array<{
    tags?: string[];
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
      normalized.installPath = normalizePathValue(plugin.installPath) ?? plugin.installPath;
    }
    return normalized;
  });
}

async function createFakeClaudeSetupFixture(initialState?: Partial<FakeClaudeState>) {
  const root = await tempRootHarness.createTempRoot();
  const homeDir = join(root, "home");
  const statePath = join(root, "fake-claude-state.json");
  const cliPath = join(root, "fake-claude.mjs");
  const packagedRoot = join(root, "packaged-claude");
  await mkdir(join(packagedRoot, ".claude-plugin"), { recursive: true });
  await writeFile(join(packagedRoot, ".claude-plugin", "marketplace.json"), "{}\n", "utf8");
  await writeFile(join(packagedRoot, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
  for (const command of buildClaudeCommandFiles(oraculumCommandManifest)) {
    await mkdir(dirname(join(packagedRoot, command.path)), { recursive: true });
    await writeFile(join(packagedRoot, command.path), command.content, "utf8");
  }
  for (const skill of buildClaudeSkillFiles(oraculumCommandManifest)) {
    await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
    await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
  }

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
    expect(plugin.name).toBe("orc");
    expect(plugin.skills).toBe("./skills/");
    expect(mcp.mcpServers).toHaveProperty("orc");
    expect(
      (mcp.mcpServers as Record<string, { env?: Record<string, string> }>).orc?.env
        ?.ORACULUM_AGENT_RUNTIME,
    ).toBe("claude-code");
    expect((mcp.mcpServers as Record<string, { timeout?: number }>).orc?.timeout).toBe(1800);

    expect(commands.map((file) => file.path)).toEqual([
      "commands/consult.md",
      "commands/verdict.md",
      "commands/verdict-archive.md",
      "commands/crown.md",
      "commands/plan.md",
      "commands/draft.md",
      "commands/init.md",
    ]);
    const consultCommand = commands.find((file) => file.path === "commands/consult.md");
    expect(consultCommand?.content).toContain("MCP only.");
    expect(consultCommand?.content).toContain("Tool: `oraculum_consult`");
    expect(consultCommand?.content).not.toContain("Read the file at");
    expect(skills.map((file) => file.path)).toEqual([
      ".claude-plugin/skills/consult/SKILL.md",
      ".claude-plugin/skills/verdict/SKILL.md",
      ".claude-plugin/skills/verdict-archive/SKILL.md",
      ".claude-plugin/skills/crown/SKILL.md",
      ".claude-plugin/skills/plan/SKILL.md",
      ".claude-plugin/skills/draft/SKILL.md",
      ".claude-plugin/skills/init/SKILL.md",
    ]);

    expect(plugin.description).toBe(
      "Consult competing candidates, read verdicts, and crown recommended results with Oraculum.",
    );
    expect(plugin.keywords).toContain("consultation");
    expect(marketplace.plugins[0]?.tags).toContain("candidate-consultation");

    const crownSkill = skills.find((file) => file.path.includes("/crown/"));
    expect(crownSkill?.content).toContain("mcp_tool: oraculum_crown");
    expect(crownSkill?.content).toContain("name: crown");
    expect(crownSkill?.content).toContain('description: "orc crown"');
    expect(crownSkill?.content).toContain('materializationName: "$1"');
    expect(crownSkill?.content).toContain("MCP only.");
    expect(crownSkill?.content).toContain("Before MCP: no user text, no file reads, no shell.");
    expect(crownSkill?.content).toContain(
      "After MCP: return only the user-relevant result or failure.",
    );
    expect(crownSkill?.content).toContain("Tool: `oraculum_crown`.");
    expect(crownSkill?.content).toContain(
      "Args: cwd=current-directory; optional first positional=materializationName.",
    );

    const consultSkill = skills.find((file) => file.path.includes("/consult/"));
    const planSkill = skills.find((file) => file.path.includes("/plan/"));
    const archiveSkill = skills.find((file) => file.path.includes("/verdict-archive/"));
    expect(consultSkill?.content).toContain('taskInput: "$ARGUMENTS"');
    expect(consultSkill?.content).toContain('agent: "claude-code"');
    expect(consultSkill?.content).toContain("name: consult");
    expect(consultSkill?.content).toContain('description: "orc consult"');
    expect(consultSkill?.content).toContain("MCP only.");
    expect(consultSkill?.content).toContain("Before MCP: no user text, no file reads, no shell.");
    expect(consultSkill?.content).toContain(
      "After MCP: return only the user-relevant result or failure.",
    );
    expect(consultSkill?.content).toContain("Tool: `oraculum_consult`.");
    expect(consultSkill?.content).toContain(
      "Args: cwd=current-directory; taskInput=$ARGUMENTS; agent=claude-code.",
    );
    expect(planSkill?.content).toContain('description: "orc plan"');
    expect(planSkill?.content).toContain("Tool: `oraculum_plan`.");
    expect(archiveSkill?.content).toContain('description: "orc verdict archive"');
    expect(archiveSkill?.content).toContain('count: "$1"');
    expect(archiveSkill?.content).toContain("Tool: `oraculum_verdict_archive`.");
    expect(archiveSkill?.content).toContain(
      "Args: cwd=current-directory; optional first positional=count.",
    );
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
  it(
    "fails before touching host wiring when packaged Claude artifacts are incomplete",
    async () => {
      const root = await tempRootHarness.createTempRoot();
      const homeDir = join(root, "home");
      const packagedRoot = join(root, "packaged-claude");
      await mkdir(join(packagedRoot, ".claude-plugin"), { recursive: true });
      await writeFile(join(packagedRoot, ".claude-plugin", "plugin.json"), "{}\n", "utf8");

      await expect(
        setupClaudeCodeHost({
          homeDir,
          packagedRoot,
        }),
      ).rejects.toThrow("Packaged Claude Code host artifacts");

      await expect(readFile(join(homeDir, ".claude", "mcp.json"), "utf8")).rejects.toThrow();
      await expect(
        readFile(
          join(
            homeDir,
            ".oraculum",
            "chat-native",
            "claude-code",
            APP_VERSION,
            "commands",
            "consult.md",
          ),
          "utf8",
        ),
      ).rejects.toThrow();
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "merges MCP config and installs the packaged plugin through the Claude CLI",
    async () => {
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
        mcpServers: Record<
          string,
          { args: string[]; command: string; env?: Record<string, string>; timeout?: number }
        >;
      };
      const effectivePluginMcpConfig = JSON.parse(
        await readFile(result.effectiveMcpConfigPath, "utf8"),
      ) as {
        mcpServers: Record<
          string,
          { args: string[]; command: string; env?: Record<string, string>; timeout?: number }
        >;
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

      expect(mcpConfig.mcpServers.orc?.command).toBe(process.execPath);
      expect(mcpConfig.mcpServers.orc?.args.at(-2)).toBe("mcp");
      expect(mcpConfig.mcpServers.orc?.args.at(-1)).toBe("serve");
      expect(mcpConfig.mcpServers.orc?.env?.ORACULUM_AGENT_RUNTIME).toBe("claude-code");
      expect(mcpConfig.mcpServers.orc?.timeout).toBe(1800);
      expect(effectivePluginMcpConfig.mcpServers.orc?.args.at(-2)).toBe("mcp");
      expect(effectivePluginMcpConfig.mcpServers.orc?.args.at(-1)).toBe("serve");
      expect(effectivePluginMcpConfig.mcpServers.orc?.env?.ORACULUM_AGENT_RUNTIME).toBe(
        "claude-code",
      );
      expect(effectivePluginMcpConfig.mcpServers.orc?.timeout).toBe(1800);
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
          id: "orc@oraculum",
          installPath: `/fake-cache/oraculum/orc/${APP_VERSION}`,
          name: "orc",
          version: APP_VERSION,
        },
      ]);
      expect(state.ops).toEqual([
        "plugin validate",
        `marketplace add ${result.installRoot}`,
        "plugin install orc",
      ]);
      await expect(
        readFile(join(result.pluginRoot, "skills", "consult", "SKILL.md"), "utf8"),
      ).resolves.toContain("Tool: `oraculum_consult`.");
      await expect(
        readFile(join(result.pluginRoot, "skills", "consult", "SKILL.md"), "utf8"),
      ).resolves.toContain("Before MCP: no user text, no file reads, no shell.");
      expect(result.pluginInstalled).toBe(true);
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "replaces stale Claude marketplace and plugin installs when their path or version drifts",
    async () => {
      const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
      const staleState: FakeClaudeState = {
        marketplaces: [
          {
            installLocation: join(
              homeDir,
              ".oraculum",
              "chat-native",
              "claude-code",
              "0.1.0-beta.5",
            ),
            name: "oraculum",
            path: join(homeDir, ".oraculum", "chat-native", "claude-code", "0.1.0-beta.5"),
            source: "directory",
          },
        ],
        ops: [],
        plugins: [
          {
            id: "oraculum@oraculum",
            installPath: "/fake-cache/oraculum/orc/0.1.0-beta.5",
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
          id: "orc@oraculum",
          installPath: `/fake-cache/oraculum/orc/${APP_VERSION}`,
          name: "orc",
          version: APP_VERSION,
        },
      ]);
      expect(state.ops).toEqual([
        "plugin validate",
        "marketplace remove oraculum",
        `marketplace add ${result.installRoot}`,
        "plugin uninstall oraculum",
        "plugin install orc",
      ]);
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "keeps an already aligned Claude marketplace and plugin install untouched",
    async () => {
      const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
      const installPath = join(
        homeDir,
        ".claude",
        "plugins",
        "cache",
        "oraculum",
        "orc",
        APP_VERSION,
      );
      await mkdir(installPath, { recursive: true });
      await writeFile(
        join(installPath, "plugin.json"),
        `${JSON.stringify({ name: "orc", version: APP_VERSION }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(join(installPath, ".mcp.json"), "{}\n", "utf8");
      for (const dirName of [
        "consult",
        "plan",
        "verdict",
        "verdict-archive",
        "crown",
        "draft",
        "init",
      ]) {
        await mkdir(join(installPath, "skills", dirName), { recursive: true });
        await writeFile(join(installPath, "skills", dirName, "SKILL.md"), `${dirName}\n`, "utf8");
      }
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
            id: "orc@oraculum",
            installPath,
            name: "orc",
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
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "reinstalls a same-version Claude plugin when the cached install is missing required artifacts",
    async () => {
      const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
      const installPath = join(
        homeDir,
        ".claude",
        "plugins",
        "cache",
        "oraculum",
        "orc",
        APP_VERSION,
      );
      await mkdir(installPath, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          marketplaces: [
            {
              installLocation: join(
                homeDir,
                ".oraculum",
                "chat-native",
                "claude-code",
                APP_VERSION,
              ),
              name: "oraculum",
              path: join(homeDir, ".oraculum", "chat-native", "claude-code", APP_VERSION),
              source: "directory",
            },
          ],
          ops: [],
          plugins: [
            {
              id: "orc@oraculum",
              installPath,
              name: "orc",
              version: APP_VERSION,
            },
          ],
        }),
        "utf8",
      );
      await writeFile(join(installPath, "plugin.json"), "{}\n", "utf8");

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
      expect(state.ops).toEqual(["plugin validate", "plugin uninstall orc", "plugin install orc"]);
      await expect(readFile(join(installPath, "plugin.json"), "utf8")).rejects.toThrow();
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "replaces stale same-version packaged Claude artifacts during setup",
    async () => {
      const { cliPath, homeDir, packagedRoot, statePath } = await createFakeClaudeSetupFixture();
      const staleCommandPath = join(
        homeDir,
        ".oraculum",
        "chat-native",
        "claude-code",
        APP_VERSION,
        "commands",
        "legacy.md",
      );
      const staleSkillPath = join(
        homeDir,
        ".oraculum",
        "chat-native",
        "claude-code",
        APP_VERSION,
        ".claude-plugin",
        "skills",
        "legacy",
        "SKILL.md",
      );

      await mkdir(dirname(staleCommandPath), { recursive: true });
      await writeFile(staleCommandPath, "stale\n", "utf8");
      await mkdir(dirname(staleSkillPath), { recursive: true });
      await writeFile(staleSkillPath, "stale\n", "utf8");

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

      await expect(readFile(staleCommandPath, "utf8")).rejects.toThrow();
      await expect(readFile(staleSkillPath, "utf8")).rejects.toThrow();
      await expect(
        readFile(join(result.installRoot, "commands", "consult.md"), "utf8"),
      ).resolves.toContain("Tool: `oraculum_consult`");
      await expect(
        readFile(join(result.pluginRoot, "skills", "consult", "SKILL.md"), "utf8"),
      ).resolves.toContain("Tool: `oraculum_consult`.");
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it(
    "uninstalls Claude marketplace/plugin wiring and removes the MCP entry",
    async () => {
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
      expect(state.ops.at(-1)).toBe("plugin uninstall orc");
      expect(mcpConfig.mcpServers).toEqual({
        other: { command: "echo", args: ["ok"] },
      });
    },
    HOST_SETUP_TEST_TIMEOUT_MS,
  );

  it("best-effort cleans local Claude artifacts when the Claude binary is unavailable", async () => {
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
            oraculum: { command: "node", args: ["cli.js", "mcp", "serve"] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(join(homeDir, ".claude", "plugins", "oraculum"), { recursive: true });
    await writeFile(join(homeDir, ".claude", "plugins", "oraculum", "plugin.json"), "{}\n", "utf8");

    const result = await uninstallClaudeCodeHost({
      claudeBinaryPath: join(homeDir, "missing-claude"),
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir,
    });

    await expect(readFile(result.mcpConfigPath, "utf8")).resolves.toContain("{}");
    await expect(
      readFile(join(homeDir, ".claude", "plugins", "oraculum", "plugin.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(result.installRoot, APP_VERSION, ".claude-plugin", "plugin.json"), "utf8"),
    ).rejects.toThrow();
    expect(result.marketplaceRemoved).toBe(false);
    expect(result.pluginRemoved).toBe(false);
  });
});
