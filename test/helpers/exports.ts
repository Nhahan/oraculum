import { runSubprocess } from "../../src/core/subprocess.js";
import { writeNodeBinary } from "./fake-binary.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-");
tempRootHarness.registerCleanup();

export async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function writeExportingCodex(cwd: string): Promise<string> {
  return writeNodeBinary(
    cwd,
    "fake-codex",
    `const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
let out = "";
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "-o") {
    out = process.argv[index + 1] ?? "";
  }
}
if (prompt.includes("You are selecting the best Oraculum finalist.")) {
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify({
        decision: "select",
        candidateId: "cand-01",
        confidence: "high",
        summary: "cand-01 is the recommended winner."
      }),
      "utf8",
    );
  }
  process.exit(0);
}
fs.writeFileSync(path.join(process.cwd(), "app.txt"), "patched\\n", "utf8");
fs.writeFileSync(path.join(process.cwd(), "added.txt"), "new file\\n", "utf8");
const removePath = path.join(process.cwd(), "remove.txt");
if (fs.existsSync(removePath)) {
  fs.unlinkSync(removePath);
}
if (out) {
  fs.writeFileSync(out, "Codex finished candidate patch", "utf8");
}
`,
  );
}

export async function initializeGitProject(cwd: string): Promise<void> {
  await runGit(cwd, ["init"]);
  await runGit(cwd, ["config", "user.name", "Oraculum Test"]);
  await runGit(cwd, ["config", "user.email", "oraculum@example.com"]);
  await runGit(cwd, ["config", "core.autocrlf", "false"]);
  await runGit(cwd, ["config", "core.eol", "lf"]);
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ["add", "-A"]);
  await runGit(cwd, ["commit", "-m", message]);
}

export async function currentBranch(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["branch", "--show-current"]);
  return result.stdout.trim();
}

export function overridePlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  return () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: original,
    });
  };
}

export function forceWin32Semantics(): () => void {
  return process.platform === "win32" ? () => {} : overridePlatform("win32");
}

async function runGit(cwd: string, args: string[]) {
  const result = await runSubprocess({
    command: "git",
    args,
    cwd,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result;
}
