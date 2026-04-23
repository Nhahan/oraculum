import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  joinPathEntries,
  resolvePackedInstallSpec,
  runOrThrow,
  writeNodeBinary,
} from "./smoke/shared-install.mjs";

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
    const installSpec = resolvePackedInstallSpec(repoRoot, tempRoot, explicitSpec);

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

    await assertPathExists(join(homeDir, ".claude", "plugins", "oraculum"));
    await assertPathExists(join(homeDir, ".codex", "skills", "route-consult", "SKILL.md"));
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
      "import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
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
      "if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') { state.marketplaces = [{ name: 'oraculum', path: args[3], installLocation: args[3] }]; writeState(state); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') { process.stdout.write(JSON.stringify(state.plugins)); process.exit(0); }",
      "if (args[0] === 'plugin' && args[1] === 'install') {",
      "  const source = state.marketplaces[0]?.path ?? state.marketplaces[0]?.installLocation;",
      "  if (!source) process.exit(12);",
      "  state.plugins = [{ name: 'orc' }];",
      "  writeState(state);",
      "  mkdirSync(pluginsDir, { recursive: true });",
      "  cpSync(join(source, '.claude-plugin'), join(pluginsDir, 'oraculum'), { recursive: true, force: true });",
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
  await writeNodeBinary(hostBinDir, "codex", "process.stdout.write('codex fake host\\n');");
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
