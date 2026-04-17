import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    expect(rules[0]?.content).toContain("## Critical: Exact-Prefix Routing");
    expect(rules[0]?.content).toContain("`oraculum_consult`");
    expect(rules[0]?.content).toContain("crown a recommended result");

    expect(skills.map((file) => file.path)).toEqual([
      "skills/oraculum-consult/SKILL.md",
      "skills/oraculum-verdict/SKILL.md",
      "skills/oraculum-verdict-archive/SKILL.md",
      "skills/oraculum-crown/SKILL.md",
      "skills/oraculum-plan/SKILL.md",
      "skills/oraculum-draft/SKILL.md",
      "skills/oraculum-init/SKILL.md",
    ]);

    const crownSkill = skills.find((file) => file.path.includes("/oraculum-crown/"));
    const consultSkill = skills.find((file) => file.path.includes("/oraculum-consult/"));
    const planSkill = skills.find((file) => file.path.includes("/oraculum-plan/"));
    expect(consultSkill?.content).toContain("default to `codex` when omitted");
    expect(consultSkill?.content).toContain(
      '`orc consult tasks/fix.md` -> `{ taskInput: "tasks/fix.md", agent: "codex" }`',
    );
    expect(consultSkill?.content).toContain("Call the MCP tool immediately with no preamble");
    expect(consultSkill?.content).toContain(
      "report only the user-relevant result concisely and stop",
    );
    expect(consultSkill?.content).toContain(
      "do not mention AGENTS.md, skills, MCP, routing, or internal tool calls",
    );
    expect(consultSkill?.content).toContain(
      "Do not automatically invoke `orc crown`, `orc verdict`, or any other follow-up Oraculum command",
    );
    expect(consultSkill?.content).toContain(
      "Never invoke `orc crown` or `orc verdict` in the same response as `orc consult`",
    );
    expect(planSkill?.content).toContain("Call the MCP tool `oraculum_plan`.");
    expect(planSkill?.content).toContain("Call the MCP tool immediately with no preamble");
    expect(planSkill?.content).toContain(
      '`orc plan tasks/fix.md` -> `{ taskInput: "tasks/fix.md", agent: "codex" }`',
    );
    expect(crownSkill?.content).toContain("Call the MCP tool `oraculum_crown`.");
    expect(crownSkill?.content).toContain("Call the MCP tool immediately with no preamble");
    expect(crownSkill?.content).toContain(
      "report only the user-relevant result concisely and stop",
    );
    expect(crownSkill?.content).toContain("required only for branch materialization");
    expect(crownSkill?.content).toContain(
      "compatibility note: the MCP request still accepts legacy `branchName`",
    );
    expect(crownSkill?.content).toContain(
      "the chat-native crowning path uses the recommended result automatically",
    );
    expect(crownSkill?.content).toContain(
      'Example: `orc crown fix/greet` -> `{ materializationName: "fix/greet" }`',
    );
    expect(crownSkill?.content).toContain("Example: `orc crown` -> no materializationName field");
    expect(getExpectedCodexRuleFileName()).toBe("oraculum.md");
    expect(getExpectedCodexSkillDirs()).toContain("oraculum-consult");
  });

  it("writes packaged Codex artifacts into dist during the build", async () => {
    const packagedRoot = getPackagedCodexRoot();
    expect(packagedRoot.replaceAll("\\", "/")).toContain("/dist/chat-native/codex");
  });
});

describe("Codex setup", () => {
  it("installs packaged skills and rules and registers the MCP server through Codex CLI", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-setup-");
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
        "  const state = { name: 'oraculum', transport: { type: 'stdio', command, args: commandArgs, env } };",
        "  writeState(state);",
        "  mkdirSync(dirname(configPath), { recursive: true });",
        "  const envLines = env.map((entry) => { const [key, value] = entry.split('='); return key + ' = \"' + value + '\"'; });",
        "  const argsLine = 'args = [' + commandArgs.map((value) => '\"' + value + '\"').join(', ') + ']';",
        "  const lines = ['[mcp_servers.oraculum]', 'command = \"' + command + '\"', argsLine, 'startup_timeout_sec = 60', 'tool_timeout_sec = 1800', '', '[mcp_servers.oraculum.env]', ...envLines];",
        "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'oraculum' && args[3] === '--json') {",
        "  const state = readState();",
        "  if (!state) process.exit(1);",
        "  process.stdout.write(JSON.stringify({ ...state, enabled: true, disabled_reason: null, enabled_tools: null, disabled_tools: null, startup_timeout_sec: 60, tool_timeout_sec: 1800 }));",
        "  process.exit(0);",
        "}",
        "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
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
    });

    const configToml = await readFile(result.configPath, "utf8");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      name: string;
      transport: {
        args: string[];
        command: string;
        env: string[];
        type: string;
      };
    };

    expect(configToml).toContain("[mcp_servers.oraculum]");
    expect(configToml).toContain('ORACULUM_AGENT_RUNTIME = "codex"');
    expect(configToml).toContain("startup_timeout_sec = 60");
    expect(configToml).toContain("tool_timeout_sec = 1800");
    expect(state.transport.command).toBe(process.execPath);
    expect(state.transport.args.at(-2)).toBe("mcp");
    expect(state.transport.args.at(-1)).toBe("serve");
    expect(state.transport.env).toContain("ORACULUM_AGENT_RUNTIME=codex");
    await expect(
      readFile(join(result.skillsRoot, "oraculum-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Oraculum consult");
    await expect(readFile(join(result.rulesRoot, "oraculum.md"), "utf8")).resolves.toContain(
      "Critical: Exact-Prefix Routing",
    );
    expect(result.installRoot).toContain(".oraculum");
    expect(result.registered).toBe(true);
  });

  it("uninstalls Codex MCP wiring and removes managed skills and rules", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-uninstall-");
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
        "  const state = { name: 'oraculum', transport: { type: 'stdio', command, args: commandArgs, env } };",
        "  writeState(state);",
        "  mkdirSync(dirname(configPath), { recursive: true });",
        "  const envLines = env.map((entry) => { const [key, value] = entry.split('='); return key + ' = \"' + value + '\"'; });",
        "  const argsLine = 'args = [' + commandArgs.map((value) => '\"' + value + '\"').join(', ') + ']';",
        "  const lines = ['[mcp_servers.oraculum]', 'command = \"' + command + '\"', argsLine, 'startup_timeout_sec = 60', 'tool_timeout_sec = 1800', '', '[mcp_servers.oraculum.env]', ...envLines];",
        "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'oraculum' && args[3] === '--json') {",
        "  const state = readState();",
        "  if (!state) process.exit(1);",
        "  process.stdout.write(JSON.stringify({ ...state, enabled: true, disabled_reason: null, enabled_tools: null, disabled_tools: null, startup_timeout_sec: 60, tool_timeout_sec: 1800 }));",
        "  process.exit(0);",
        "}",
        "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
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
    });
    await expect(
      readFile(join(setupResult.skillsRoot, "oraculum-consult", "SKILL.md"), "utf8"),
    ).resolves.toContain("# Oraculum consult");

    const uninstallResult = await uninstallCodexHost({
      codexBinaryPath: process.execPath,
      codexArgs: [cliPath],
      env: {
        ORACULUM_FAKE_CODEX_STATE: statePath,
      },
      homeDir,
    });

    await expect(readFile(statePath, "utf8")).rejects.toThrow();
    await expect(
      readFile(join(uninstallResult.skillsRoot, "oraculum-consult", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(uninstallResult.rulesRoot, "oraculum.md"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(uninstallResult.configPath, "utf8")).resolves.not.toContain(
      "[mcp_servers.oraculum]",
    );
  });

  it("best-effort cleans local Codex wiring when the Codex binary is unavailable", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-codex-uninstall-missing-");
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
        "  const state = { name: 'oraculum', transport: { type: 'stdio', command, args: commandArgs, env } };",
        "  writeState(state);",
        "  mkdirSync(dirname(configPath), { recursive: true });",
        "  const envLines = env.map((entry) => { const [key, value] = entry.split('='); return key + ' = \"' + value + '\"'; });",
        "  const argsLine = 'args = [' + commandArgs.map((value) => '\"' + value + '\"').join(', ') + ']';",
        "  const lines = ['[mcp_servers.oraculum]', 'command = \"' + command + '\"', argsLine, 'startup_timeout_sec = 60', 'tool_timeout_sec = 1800', '', '[mcp_servers.oraculum.env]', ...envLines];",
        "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'oraculum' && args[3] === '--json') {",
        "  const state = readState();",
        "  if (!state) process.exit(1);",
        "  process.stdout.write(JSON.stringify({ ...state, enabled: true, disabled_reason: null, enabled_tools: null, disabled_tools: null, startup_timeout_sec: 60, tool_timeout_sec: 1800 }));",
        "  process.exit(0);",
        "}",
        "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
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
    });

    const uninstallResult = await uninstallCodexHost({
      codexBinaryPath: join(homeDir, "missing-codex"),
      homeDir,
    });

    await expect(
      readFile(join(uninstallResult.skillsRoot, "oraculum-consult", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(uninstallResult.rulesRoot, "oraculum.md"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(uninstallResult.configPath, "utf8")).resolves.not.toContain(
      "[mcp_servers.oraculum]",
    );
    await expect(
      readFile(join(setupResult.installRoot, "rules", "oraculum.md"), "utf8"),
    ).rejects.toThrow();
  });
});
