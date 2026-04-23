import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../src/core/constants.js";
import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildClaudeCommandFiles,
  buildClaudeMarketplaceManifest,
  buildClaudePluginManifest,
  buildClaudeSkillFiles,
  getPackagedClaudeCodeRoot,
  setupClaudeCodeHost,
  uninstallClaudeCodeHost,
} from "../src/services/claude-chat-native.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-claude-setup-");
tempRootHarness.registerCleanup();

async function createFakeClaudeSetupFixture() {
  const root = await tempRootHarness.createTempRoot();
  const homeDir = join(root, "home");
  const statePath = join(root, "fake-claude-state.json");
  const cliPath = join(root, "fake-claude.mjs");
  const packagedRoot = join(root, "packaged-claude");

  await mkdir(join(packagedRoot, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(packagedRoot, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(buildClaudeMarketplaceManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(packagedRoot, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(buildClaudePluginManifest(), null, 2)}\n`,
    "utf8",
  );
  for (const command of buildClaudeCommandFiles(oraculumCommandManifest)) {
    await mkdir(dirname(join(packagedRoot, command.path)), { recursive: true });
    await writeFile(join(packagedRoot, command.path), command.content, "utf8");
  }
  for (const skill of buildClaudeSkillFiles(oraculumCommandManifest)) {
    await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
    await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
  }

  await writeFile(statePath, JSON.stringify({ marketplaces: [], ops: [], plugins: [] }), "utf8");

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
      "if (args[0] === 'plugin' && args[1] === 'validate') { state.ops.push('plugin validate'); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list' && args[3] === '--json') { process.stdout.write(JSON.stringify(state.marketplaces)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { const source = args[3]; state.marketplaces = [{ name: 'oraculum', source: 'directory', path: source, installLocation: source }]; state.ops.push('marketplace add ' + source); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') { state.marketplaces = []; state.ops.push('marketplace remove'); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') { process.stdout.write(JSON.stringify(state.plugins)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'install') { state.plugins = [{ id: 'orc@oraculum', name: 'orc', version: pluginVersion, installPath: join('/fake-cache', 'oraculum', 'orc', pluginVersion) }]; state.ops.push('plugin install orc'); save(); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'uninstall') { state.plugins = []; state.ops.push('plugin uninstall ' + args[2]); save(); process.exit(0); }",
      "process.exit(9);",
    ].join("\n"),
    "utf8",
  );

  return {
    cliPath,
    homeDir,
    packagedRoot,
    statePath,
  };
}

describe("Claude Code chat-native packaging", () => {
  it("generates marketplace, plugin, command, and skill artifacts from the shared manifest", () => {
    const marketplace = buildClaudeMarketplaceManifest();
    const plugin = buildClaudePluginManifest();
    const commands = buildClaudeCommandFiles(oraculumCommandManifest);
    const skills = buildClaudeSkillFiles(oraculumCommandManifest);

    expect(marketplace.name).toBe("oraculum");
    expect(plugin.name).toBe("orc");
    expect(plugin).not.toHaveProperty("mcpServers");
    expect(commands.map((file) => file.path)).toContain("commands/consult.md");
    expect(skills.map((file) => file.path)).toContain(".claude-plugin/skills/consult/SKILL.md");
    expect(skills.find((file) => file.path.endsWith("/consult/SKILL.md"))?.content).toContain(
      "If empty, resume the latest running consultation first",
    );
  });

  it("resolves the packaged Claude root inside dist", () => {
    expect(getPackagedClaudeCodeRoot().replaceAll("\\", "/")).toContain(
      "/dist/chat-native/claude-code",
    );
  });
});

describe("Claude Code setup", () => {
  it("installs packaged plugin artifacts for direct CLI routing through Claude CLI", async () => {
    const fixture = await createFakeClaudeSetupFixture();
    const result = await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [fixture.cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: fixture.statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir: fixture.homeDir,
      packagedRoot: fixture.packagedRoot,
    });

    await expect(readFile(join(result.pluginRoot, "plugin.json"), "utf8")).resolves.toContain(
      '"name": "orc"',
    );
    expect((await readdir(result.pluginRoot)).filter((entry) => entry.endsWith(".tmp"))).toEqual(
      [],
    );
  });

  it("uninstalls Claude plugin marketplace", async () => {
    const fixture = await createFakeClaudeSetupFixture();
    await setupClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [fixture.cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: fixture.statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir: fixture.homeDir,
      packagedRoot: fixture.packagedRoot,
    });

    const result = await uninstallClaudeCodeHost({
      claudeBinaryPath: process.execPath,
      claudeArgs: [fixture.cliPath],
      env: {
        ORACULUM_FAKE_CLAUDE_STATE: fixture.statePath,
        ORACULUM_FAKE_PLUGIN_VERSION: APP_VERSION,
      },
      homeDir: fixture.homeDir,
    });

    expect(result.pluginRemoved).toBe(true);
  });
});
