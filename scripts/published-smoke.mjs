import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const publishedSpec = process.env.ORACULUM_PUBLISHED_SPEC ?? "oraculum@beta";
const keepEvidence = process.env.ORACULUM_KEEP_EVIDENCE === "1";

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "oraculum-published-smoke-"));

  try {
    const prefix = join(tempRoot, "prefix");
    const projectRoot = join(tempRoot, "project");
    await mkdir(prefix, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    runOrThrow("npm", ["install", "-g", "--prefix", prefix, publishedSpec], { cwd: tempRoot });

    const oraculumBinary =
      process.platform === "win32" ? join(prefix, "oraculum.cmd") : join(prefix, "bin", "oraculum");
    if (!existsSync(oraculumBinary)) {
      throw new Error(`Installed Oraculum binary was not found at ${oraculumBinary}.`);
    }
    const packageRootCandidates =
      process.platform === "win32"
        ? [join(prefix, "node_modules", "oraculum")]
        : [join(prefix, "lib", "node_modules", "oraculum"), join(prefix, "node_modules", "oraculum")];
    const packageRoot = packageRootCandidates.find((candidate) => existsSync(candidate));
    if (!packageRoot) {
      throw new Error(`Installed Oraculum package directory was not found under ${prefix}.`);
    }
    const oraculumCliPath = join(packageRoot, "dist", "cli.js");
    if (!existsSync(oraculumCliPath)) {
      throw new Error(`Installed Oraculum CLI entry was not found at ${oraculumCliPath}.`);
    }

    await writeFile(
      join(projectRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "published-smoke",
          version: "0.0.0",
          type: "module",
          main: "./src/index.js",
          exports: {
            ".": "./src/index.js",
          },
          scripts: {
            lint: 'node -e "process.exit(0)"',
            typecheck: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "index.js"),
      'export function greet() {\n  return "Bye";\n}\n',
      "utf8",
    );
    await mkdir(join(projectRoot, "node_modules", ".bin"), { recursive: true });
    const fakeBinaryPath = await writeNodeBinary(
      projectRoot,
      "published-smoke-codex",
      `const fs = require("node:fs");
const path = require("node:path");

const prompt = fs.readFileSync(0, "utf8");
const args = process.argv.slice(2);
const candidateMatch = prompt.match(/^Candidate ID: (.+)$/m);
const candidateId = candidateMatch ? candidateMatch[1].trim() : "cand-01";
const isProfile = prompt.includes("You are selecting the best Oraculum consultation profile");
const isWinner = prompt.includes("You are selecting the best Oraculum finalist.");

function profilePayload() {
  return {
    profileId: "library",
    confidence: "high",
    summary: "library profile fits the repository signals.",
    candidateCount: 2,
    strategyIds: ["minimal-change", "test-amplified"],
    selectedCommandIds: ["lint-fast", "typecheck-fast", "unit-impact", "full-suite-deep"],
    missingCapabilities: [],
  };
}

function winnerPayload() {
  return {
    candidateId: "cand-02",
    confidence: "high",
    summary: "cand-02 preserved the strongest evidence.",
  };
}

function mutateWorkspace() {
  const file = path.join(process.cwd(), "src", "index.js");
  const next = fs.readFileSync(file, "utf8").replace('"Bye"', '"Hello from ' + candidateId + '"');
  fs.writeFileSync(file, next, "utf8");
}

if (!isProfile && !isWinner) {
  mutateWorkspace();
}

let out = "";
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "-o") {
    out = args[index + 1] || "";
  }
}

process.stdout.write(JSON.stringify({ event: "started" }) + "\\n");
if (out) {
  const payload = isProfile ? profilePayload() : isWinner ? winnerPayload() : "candidate patch ready";
  fs.writeFileSync(out, typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
}
process.exit(0);
`,
    );

    runOrThrow("git", ["init"], { cwd: projectRoot });
    runOrThrow("git", ["config", "user.name", "Smoke Bot"], { cwd: projectRoot });
    runOrThrow("git", ["config", "user.email", "smoke@example.com"], { cwd: projectRoot });
    runOrThrow("git", ["add", "."], { cwd: projectRoot });
    runOrThrow("git", ["commit", "-m", "base"], { cwd: projectRoot });

    const env = {
      ...process.env,
      ORACULUM_CODEX_BIN: fakeBinaryPath,
    };

    const consult = runOrThrow(
      process.execPath,
      [
        oraculumCliPath,
        "consult",
        "Update src/index.js so greet() returns a winner-specific hello string.",
        "--agent",
        "codex",
        "--candidates",
        "2",
        "--timeout-ms",
        "20000",
      ],
      { cwd: projectRoot, env },
    );
    assertContains(consult.stdout, "Consultation complete.");

    const crown = runOrThrow(
      process.execPath,
      [oraculumCliPath, "crown", "--branch", "fix/published-smoke"],
      {
        cwd: projectRoot,
        env,
      },
    );
    assertContains(crown.stdout, "Crowned cand-02");

    const branch = runOrThrow("git", ["branch", "--show-current"], {
      cwd: projectRoot,
    }).stdout.trim();
    if (branch !== "fix/published-smoke") {
      throw new Error(`Expected crowned branch fix/published-smoke, received ${branch}.`);
    }
    const contents = await readFile(join(projectRoot, "src", "index.js"), "utf8");
    assertContains(contents, "cand-02");

    process.stdout.write(`Published smoke passed for ${publishedSpec}.\n`);
  } finally {
    if (!keepEvidence) {
      await rm(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Published smoke workspace preserved at ${tempRoot}\n`);
    }
  }
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

function runOrThrow(command, args, options) {
  const shell =
    process.platform === "win32" &&
    (["bun", "npm", "npx", "pnpm", "yarn", "yarnpkg"].includes(command.toLowerCase()) ||
      /\.(cmd|bat)$/iu.test(command));
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    ...(shell ? { shell } : {}),
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

function assertContains(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Expected output to contain "${expected}".\nReceived:\n${value}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
