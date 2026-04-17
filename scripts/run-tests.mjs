import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const vitestEntrypoint = join(repoRoot, "node_modules", "vitest", "vitest.mjs");

const mode = process.argv[2] ?? "default";
const passthroughArgs = process.argv.slice(3);
const env = { ...process.env };

if (mode === "slow") {
  env.ORACULUM_TEST_MODE = "slow";
} else if (mode === "full") {
  env.ORACULUM_TEST_MODE = "full";
} else if (mode !== "default" && mode !== "watch") {
  process.stderr.write(`Unknown test mode: ${mode}\n`);
  process.exit(1);
}

const vitestArgs = [vitestEntrypoint, mode === "watch" ? "watch" : "run", ...passthroughArgs];
const child = spawn(process.execPath, vitestArgs, {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
