import type { Adapter } from "../../domain/config.js";

export function stripForwardedWrapperSeparator(args: string[]): string[] {
  return args[0] === "--" ? args.slice(1) : args;
}

export function extractOrcCommandLine(host: Adapter, args: string[]): string | undefined {
  const firstPositionalIndex = findFirstPositionalIndex(args, host);
  if (firstPositionalIndex == null) {
    return undefined;
  }

  const promptTokens = args.slice(firstPositionalIndex);
  if (promptTokens.length === 0) {
    return undefined;
  }

  const [firstToken] = promptTokens;
  if (!firstToken) {
    return undefined;
  }

  if (firstToken === "orc") {
    return promptTokens.join(" ");
  }

  if (firstToken.startsWith("orc ")) {
    return firstToken;
  }

  return undefined;
}

function findFirstPositionalIndex(args: string[], host: Adapter): number | undefined {
  const optionsWithValues =
    host === "codex"
      ? new Set([
          "-c",
          "--config",
          "--remote",
          "--remote-auth-token-env",
          "-i",
          "--image",
          "-m",
          "--model",
          "--local-provider",
          "-p",
          "--profile",
          "-s",
          "--sandbox",
          "-a",
          "--ask-for-approval",
          "-C",
          "--cd",
          "--add-dir",
        ])
      : new Set([
          "--add-dir",
          "--agent",
          "--agents",
          "--allowedTools",
          "--allowed-tools",
          "--append-system-prompt",
          "--betas",
          "-d",
          "--debug",
          "--debug-file",
          "--disallowedTools",
          "--disallowed-tools",
          "--effort",
          "--fallback-model",
          "--file",
          "--input-format",
          "--json-schema",
          "--max-budget-usd",
          "--mcp-config",
          "--model",
          "-n",
          "--name",
          "--output-format",
          "--permission-mode",
          "--plugin-dir",
          "-r",
          "--resume",
          "--remote-control-session-name-prefix",
          "--session-id",
          "--setting-sources",
          "--settings",
          "--system-prompt",
          "--tools",
          "-w",
          "--worktree",
        ]);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--") {
      return index + 1;
    }

    if (!token.startsWith("-")) {
      return index;
    }

    if (token.startsWith("--")) {
      if (token.includes("=")) {
        continue;
      }

      if (optionsWithValues.has(token)) {
        index += 1;
      }
      continue;
    }

    if (optionsWithValues.has(token)) {
      index += 1;
    }
  }

  return undefined;
}
