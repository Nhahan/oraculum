import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const explicitSpec = process.env.ORACULUM_RELEASE_SPEC;
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-release-smoke-"));

  try {
    const prefix = join(tempRoot, "prefix");
    const homeDir = join(tempRoot, "home");
    const hostBinDir = join(tempRoot, "host-bin");
    const fakeClaudeStatePath = join(tempRoot, "fake-claude-state.json");
    const fakeCodexStatePath = join(tempRoot, "fake-codex-state.json");
    const installSpec = resolveInstallSpec(tempRoot);

    await mkdir(prefix, { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(hostBinDir, { recursive: true });

    await writeFakeClaudeHost(hostBinDir);
    await writeFakeCodexHost(hostBinDir);

    runOrThrow("npm", ["install", "-g", "--prefix", prefix, installSpec], { cwd: tempRoot });

    const oraculumBinary =
      process.platform === "win32" ? join(prefix, "oraculum.cmd") : join(prefix, "bin", "oraculum");
    if (!existsSync(oraculumBinary)) {
      throw new Error(`Installed Oraculum binary was not found at ${oraculumBinary}.`);
    }

    const env = {
      ...process.env,
      HOME: homeDir,
      ORACULUM_FAKE_CLAUDE_STATE: fakeClaudeStatePath,
      ORACULUM_FAKE_CODEX_STATE: fakeCodexStatePath,
      PATH: joinPathEntries([
        hostBinDir,
        process.platform === "win32" ? prefix : join(prefix, "bin"),
        process.env.PATH ?? "",
      ]),
    };

    const before = JSON.parse(
      runOrThrow(oraculumBinary, ["setup", "status", "--json"], {
        cwd: tempRoot,
        env,
      }).stdout,
    );
    assertHostStatus(before, "claude-code", "needs-setup");
    assertHostStatus(before, "codex", "needs-setup");

    runOrThrow(oraculumBinary, ["setup", "--runtime", "claude-code"], {
      cwd: tempRoot,
      env,
    });
    runOrThrow(oraculumBinary, ["setup", "--runtime", "codex"], {
      cwd: tempRoot,
      env,
    });

    const after = JSON.parse(
      runOrThrow(oraculumBinary, ["setup", "status", "--json"], {
        cwd: tempRoot,
        env,
      }).stdout,
    );
    assertHostStatus(after, "claude-code", "ready");
    assertHostStatus(after, "codex", "ready");

    await assertPathExists(join(homeDir, ".claude", "mcp.json"));
    await assertPathExists(join(homeDir, ".claude", "plugins", "oraculum"));
    await assertPathExists(join(homeDir, ".codex", "config.toml"));
    await assertPathExists(join(homeDir, ".codex", "skills", "oraculum-consult", "SKILL.md"));
    await assertPathExists(join(homeDir, ".codex", "rules", "oraculum.md"));

    process.stdout.write(`Release smoke passed for ${installSpec}.\n`);
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Release smoke workspace preserved at ${tempRoot}\n`);
    }
  }
}

async function writeFakeClaudeHost(hostBinDir) {
  const cliPath = join(hostBinDir, "fake-claude-host.mjs");
  await writeFile(
    cliPath,
    [
      "import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      "const statePath = process.env.ORACULUM_FAKE_CLAUDE_STATE;",
      "const homeDir = process.env.HOME;",
      "if (!statePath || !homeDir) process.exit(11);",
      "const args = process.argv.slice(2);",
      "const pluginsDir = join(homeDir, '.claude', 'plugins');",
      "const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: [], plugins: [] };",
      "const writeState = (value) => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(value)); };",
      "const state = readState();",
      "if (args[0] === 'plugin' && args[1] === 'validate') { process.stdout.write('ok\\n'); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'list' && args[3] === '--json') { process.stdout.write(JSON.stringify(state.marketplaces)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { state.marketplaces = [{ name: 'oraculum' }]; writeState(state); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') { process.stdout.write(JSON.stringify(state.plugins)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'install') {",
      "  state.plugins = [{ name: 'oraculum' }];",
      "  writeState(state);",
      "  mkdirSync(join(pluginsDir, 'oraculum'), { recursive: true });",
      "  writeFileSync(join(pluginsDir, 'oraculum', 'plugin.json'), '{}\\n');",
      "  process.exit(0);",
      "}",
      "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
    ].join("\n"),
    "utf8",
  );

  await writeNodeBinary(
    hostBinDir,
    "claude",
    [
      'const { spawnSync } = require("node:child_process");',
      `const result = spawnSync(process.execPath, [${JSON.stringify(cliPath)}, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });`,
      "process.exit(result.status ?? 1);",
    ].join("\n"),
  );
}

async function writeFakeCodexHost(hostBinDir) {
  const cliPath = join(hostBinDir, "fake-codex-host.mjs");
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
      "  const lines = ['[mcp_servers.oraculum]', 'command = \"' + command + '\"', argsLine, '', '[mcp_servers.oraculum.env]', ...envLines];",
      "  writeFileSync(configPath, lines.join('\\n') + '\\n');",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'mcp' && args[1] === 'get' && args[2] === 'oraculum' && args[3] === '--json') {",
      "  const state = readState();",
      "  if (!state) process.exit(1);",
      "  process.stdout.write(JSON.stringify({ ...state, enabled: true, disabled_reason: null, enabled_tools: null, disabled_tools: null, startup_timeout_sec: null, tool_timeout_sec: null }));",
      "  process.exit(0);",
      "}",
      "process.stderr.write('unexpected args: ' + args.join(' ')); process.exit(9);",
    ].join("\n"),
    "utf8",
  );

  await writeNodeBinary(
    hostBinDir,
    "codex",
    [
      'const { spawnSync } = require("node:child_process");',
      `const result = spawnSync(process.execPath, [${JSON.stringify(cliPath)}, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });`,
      "process.exit(result.status ?? 1);",
    ].join("\n"),
  );
}

async function writeNodeBinary(root, name, source) {
  const scriptPath = join(root, `${name}.cjs`);
  await writeFile(scriptPath, source, "utf8");

  if (process.platform === "win32") {
    const wrapperPath = join(root, `${name}.cmd`);
    const nodePath = process.execPath.replace(/"/g, '""');
    await writeFile(wrapperPath, `@echo off\r\n"${nodePath}" "%~dp0\\${name}.cjs" %*\r\n`, "utf8");
    return wrapperPath;
  }

  const wrapperPath = join(root, name);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

function resolveInstallSpec(tempRoot) {
  if (explicitSpec) {
    return explicitSpec;
  }

  if (!existsSync(join(repoRoot, "dist"))) {
    runOrThrow("npm", ["run", "build"], { cwd: repoRoot });
  }

  const pack = runOrThrow("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: repoRoot,
  });
  const parsed = JSON.parse(pack.stdout);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`Unable to determine packed artifact from npm pack output:\n${pack.stdout}`);
  }

  return join(tempRoot, filename);
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function joinPathEntries(entries) {
  return entries.filter((entry) => entry.length > 0).join(process.platform === "win32" ? ";" : ":");
}

function assertHostStatus(diagnostics, hostId, expectedStatus) {
  const host = diagnostics.hosts.find((entry) => entry.host === hostId);
  if (!host) {
    throw new Error(`Missing ${hostId} in setup diagnostics.`);
  }
  if (host.status !== expectedStatus) {
    throw new Error(
      `Expected ${hostId} status ${expectedStatus}, received ${host.status}.\n${JSON.stringify(diagnostics, null, 2)}`,
    );
  }
}

async function assertPathExists(path) {
  if (!existsSync(path)) {
    throw new Error(`Expected path to exist: ${path}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
