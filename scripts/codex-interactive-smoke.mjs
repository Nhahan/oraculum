import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { runInteractiveHostSmoke } from "./host-native-smoke/interactive.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] ? resolvePath(process.argv[1]) === scriptPath : false;

async function main() {
  const cwd = process.cwd();
  const prompt = process.argv[2] ?? 'orc consult "안녕"';
  const result = await runInteractiveHostSmoke({
    cwd,
    prompt,
    runtime: "codex",
  });

  process.stdout.write(`${result.meaningfulTail || result.transcript}\n`);
  process.stdout.write(
    `\n[interactive-smoke] approvalApplied=${result.approvalApplied ? "yes" : "no"}\n`,
  );
}

if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
