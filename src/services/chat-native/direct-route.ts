import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { OraculumError } from "../../core/errors.js";
import { writeTextFileAtomically } from "../project.js";

export interface DirectCliInvocation {
  args: string[];
  command: string;
}

export function resolveDirectCliInvocation(): DirectCliInvocation {
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    throw new OraculumError("Cannot determine the current Oraculum CLI entry for host setup.");
  }

  return {
    command: process.execPath,
    args: [cliEntry],
  };
}

export async function rewriteDirectRouteInvocation(options: {
  root: string;
  invocation: DirectCliInvocation;
}): Promise<void> {
  const replacement = `${formatShellCommand([
    options.invocation.command,
    ...options.invocation.args,
  ])} orc`;
  await rewriteTextFiles(options.root, (content) =>
    content.replaceAll("oraculum orc", replacement),
  );
}

function formatShellCommand(parts: string[]): string {
  return parts.map((part) => shellQuote(part, process.platform)).join(" ");
}

function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    if (/^[A-Za-z0-9_./:\\:=@+-]+$/u.test(value)) {
      return value;
    }

    return `"${value.replaceAll('"', '""')}"`;
  }

  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function rewriteTextFiles(root: string, rewrite: (content: string) => string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await rewriteTextFiles(path, rewrite);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const current = await readFile(path, "utf8");
    const next = rewrite(current);
    if (next !== current) {
      await writeTextFileAtomically(path, next);
    }
  }
}
