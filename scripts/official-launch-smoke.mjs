import { spawn } from "node:child_process";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { readLatestRunIdIfPresent, waitForNextCompletedRun } from "./host-native-smoke/polling.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] ? resolvePath(process.argv[1]) === scriptPath : true;

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const runtime = parseRuntime(args);
  const prompt = extractPrompt(args) ?? 'orc consult "안녕"';
  const cwd = process.cwd();
  const cliPath = join(repoRoot, "dist", "cli.js");
  const previousRunId = prompt.trimStart().startsWith("orc consult ")
    ? await readLatestRunIdIfPresent(cwd)
    : undefined;

  const hostWrapperArgs = [cliPath, "host-wrapper", runtime, "--", prompt];

  const result = await runOfficialLaunchCommand(process.execPath, hostWrapperArgs, cwd, {
    ...process.env,
    ORACULUM_HOST_WRAPPER_REAL_BINARY: "",
  });

  const completion =
    previousRunId == null
      ? undefined
      : await waitForNextCompletedRun(cwd, {
          label: `${runtime} official launch consult`,
          previousRunId,
          timeoutMs: 60_000,
          pollIntervalMs: 1_000,
        }).catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));

  const payload = {
    host: runtime,
    mode: "launch-time",
    policy: "official",
    validationTier: "stable",
    pass:
      result.stdout.trim().length > 0 &&
      (!completion || ("runId" in completion && typeof completion.runId === "string")),
    prompt,
    summary: result.stdout.trim(),
    stderr: result.stderr.trim(),
    completion,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runOfficialLaunchCommand(command, args, cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
    }, 120_000);

    child.stdin.end();
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(
          new Error(
            [
              "official launch smoke failed",
              `exitCode=${code ?? "null"} signal=${signal ?? "null"}`,
              stdout ? `stdout:\n${stdout}` : "",
              stderr ? `stderr:\n${stderr}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseRuntime(args) {
  const runtime = args.find((value) => value === "codex" || value === "claude-code");
  if (!runtime) {
    throw new Error('official-launch-smoke requires runtime "codex" or "claude-code".');
  }
  return runtime;
}

function extractPrompt(args) {
  return args.find((value) => value !== "--json" && value !== "codex" && value !== "claude-code");
}

if (isEntrypoint) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
