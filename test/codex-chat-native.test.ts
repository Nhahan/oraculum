import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildCodexRuleFiles,
  buildCodexSkillFiles,
  getExpectedCodexRuleFileName,
  getExpectedCodexSkillDirs,
  getPackagedCodexRoot,
  setupCodexHost,
  uninstallCodexHost,
} from "../src/services/codex-chat-native.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-codex-setup-");
tempRootHarness.registerCleanup();

describe("Codex chat-native packaging", () => {
  it("generates rules and skills from the shared manifest", () => {
    const rules = buildCodexRuleFiles(oraculumCommandManifest);
    const skills = buildCodexSkillFiles(oraculumCommandManifest);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.path).toBe("rules/oraculum.md");
    expect(rules[0]?.content).toContain("## Exact-Prefix Dispatch");
    expect(skills.map((file) => file.path)).toEqual([
      "skills/route-consult/SKILL.md",
      "skills/route-verdict/SKILL.md",
      "skills/route-verdict-archive/SKILL.md",
      "skills/route-crown/SKILL.md",
      "skills/route-plan/SKILL.md",
      "skills/route-draft/SKILL.md",
      "skills/route-init/SKILL.md",
    ]);
    expect(getExpectedCodexRuleFileName()).toBe("oraculum.md");
    expect(getExpectedCodexSkillDirs()).toContain("route-consult");
  });

  it("resolves the packaged Codex root inside dist", () => {
    expect(getPackagedCodexRoot().replaceAll("\\", "/")).toContain("/dist/chat-native/codex");
  });
});

describe("Codex setup", () => {
  it("fails before touching host wiring when packaged Codex artifacts are incomplete", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-missing-packaged-");
    const homeDir = join(root, "home");
    const packagedRoot = join(root, "packaged-codex");
    await mkdir(join(packagedRoot, "rules"), { recursive: true });
    await writeFile(join(packagedRoot, "rules", "oraculum.md"), "# Oraculum\n", "utf8");

    await expect(
      setupCodexHost({
        homeDir,
        packagedRoot,
        platform: "darwin",
      }),
    ).rejects.toThrow("Packaged Codex host artifacts are incomplete.");
  });

  it("installs packaged skills and rules and registers the MCP server through Codex CLI", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-install-");
    const homeDir = join(root, "home");
    const statePath = join(root, "fake-codex-state.json");
    const cliPath = join(root, "fake-codex.mjs");
    const packagedRoot = join(root, "packaged-codex");

    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
      await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, rule.path)), { recursive: true });
      await writeFile(join(packagedRoot, rule.path), rule.content, "utf8");
    }

    await writeFile(
      cliPath,
      [
        "import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
        "import { dirname, join } from 'node:path';",
        "const statePath = process.env.ORACULUM_FAKE_CODEX_STATE;",
        "const homeDir = process.env.HOME;",
        "if (!statePath || !homeDir) process.exit(11);",
        "const args = process.argv.slice(2);",
        "const configPath = join(homeDir, '.codex', 'config.toml');",
        "const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;",
        "const writeState = (value) => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(value)); };",
        "if (args[0] === 'mcp' && args[1] === 'remove') { rmSync(statePath, { force: true }); process.exit(0); }",
        "if (args[0] === 'mcp' && args[1] === 'add') {",
        "  const sep = args.indexOf('--');",
        "  const command = sep >= 0 ? args[sep + 1] : null;",
        "  const commandArgs = sep >= 0 ? args.slice(sep + 2) : [];",
        "  const env = [];",
        "  for (let index = 3; index < (sep >= 0 ? sep : args.length); index += 1) {",
        "    if (args[index] === '--env') env.push(args[index + 1]);",
        "  }",
        "  writeState({ name: 'orc', transport: { type: 'stdio', command, args: commandArgs, env } });",
        "  mkdirSync(dirname(configPath), { recursive: true });",
        "  const envLines = env.map((entry) => { const [key, value] = entry.split('='); return key + ' = \"' + value + '\"'; });",
        "  const argsLine = 'args = [' + commandArgs.map((value) => '\"' + value + '\"').join(', ') + ']';",
        "  const lines = ['[mcp_servers.orc]', 'command = \"' + command + '\"', argsLine, 'startup_timeout_sec = 60', 'tool_timeout_sec = 1800', '', '[mcp_servers.orc.env]', ...envLines];",
        "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'orc' && args[3] === '--json') {",
        "  const state = readState();",
        "  if (!state) process.exit(1);",
        "  process.stdout.write(JSON.stringify({ ...state, enabled: true, disabled_reason: null, enabled_tools: null, disabled_tools: null, startup_timeout_sec: 60, tool_timeout_sec: 1800 }));",
        "  process.exit(0);",
        "}",
        "process.exit(9);",
      ].join("\n"),
      "utf8",
    );

    const result = await setupCodexHost({
      codexBinaryPath: process.execPath,
      codexArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CODEX_STATE: statePath,
      },
      homeDir,
      packagedRoot,
      platform: "darwin",
    });

    await expect(
      readFile(join(result.skillsRoot, "route-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain("Tool: oraculum_consult");
    await expect(readFile(join(result.rulesRoot, "oraculum.md"), "utf8")).resolves.toContain(
      "Handle exact `orc ...` commands through Oraculum MCP tools.",
    );
    await expect(readFile(result.configPath, "utf8")).resolves.toContain("[mcp_servers.orc]");
  });

  it("uninstalls Codex MCP wiring and removes managed skills and rules", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-uninstall-");
    const homeDir = join(root, "home");
    const statePath = join(root, "fake-codex-state.json");
    const cliPath = join(root, "fake-codex-uninstall.mjs");
    const packagedRoot = join(root, "packaged-codex");

    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, skill.path)), { recursive: true });
      await writeFile(join(packagedRoot, skill.path), skill.content, "utf8");
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      await mkdir(dirname(join(packagedRoot, rule.path)), { recursive: true });
      await writeFile(join(packagedRoot, rule.path), rule.content, "utf8");
    }

    await writeFile(
      cliPath,
      [
        "import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
        "import { dirname, join } from 'node:path';",
        "const statePath = process.env.ORACULUM_FAKE_CODEX_STATE;",
        "const homeDir = process.env.HOME;",
        "if (!statePath || !homeDir) process.exit(11);",
        "const args = process.argv.slice(2);",
        "const configPath = join(homeDir, '.codex', 'config.toml');",
        "const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;",
        "const writeState = (value) => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(value)); };",
        "if (args[0] === 'mcp' && args[1] === 'remove') { rmSync(statePath, { force: true }); process.exit(0); }",
        "if (args[0] === 'mcp' && args[1] === 'add') {",
        "  const sep = args.indexOf('--');",
        "  const command = sep >= 0 ? args[sep + 1] : null;",
        "  const commandArgs = sep >= 0 ? args.slice(sep + 2) : [];",
        "  const env = [];",
        "  for (let index = 3; index < (sep >= 0 ? sep : args.length); index += 1) {",
        "    if (args[index] === '--env') env.push(args[index + 1]);",
        "  }",
        "  writeState({ name: 'orc', transport: { type: 'stdio', command, args: commandArgs, env } });",
        "  mkdirSync(dirname(configPath), { recursive: true });",
        "  const envLines = env.map((entry) => { const [key, value] = entry.split('='); return key + ' = \"' + value + '\"'; });",
        "  const argsLine = 'args = [' + commandArgs.map((value) => '\"' + value + '\"').join(', ') + ']';",
        "  const lines = ['[mcp_servers.orc]', 'command = \"' + command + '\"', argsLine, 'startup_timeout_sec = 60', 'tool_timeout_sec = 1800', '', '[mcp_servers.orc.env]', ...envLines];",
        "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
        "  process.exit(0);",
        "}",
        "process.exit(9);",
      ].join("\n"),
      "utf8",
    );

    const setupResult = await setupCodexHost({
      codexBinaryPath: process.execPath,
      codexArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CODEX_STATE: statePath,
      },
      homeDir,
      packagedRoot,
      platform: "darwin",
    });

    const uninstallResult = await uninstallCodexHost({
      codexBinaryPath: process.execPath,
      codexArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CODEX_STATE: statePath,
      },
      homeDir,
      platform: "darwin",
    });

    await expect(readFile(statePath, "utf8")).rejects.toThrow();
    await expect(readdir(uninstallResult.skillsRoot)).resolves.not.toContain("route-consult");
    await expect(
      readFile(join(uninstallResult.rulesRoot, "oraculum.md"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(uninstallResult.configPath, "utf8")).resolves.not.toContain(
      "[mcp_servers.orc]",
    );
    await expect(
      readFile(join(setupResult.installRoot, "rules", "oraculum.md"), "utf8"),
    ).rejects.toThrow();
  });
});
