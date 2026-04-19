import { OraculumError } from "../../core/errors.js";
import type { CommandArgument, CommandManifestEntry } from "../../domain/chat-native.js";
import { oraculumCommandManifest } from "../chat-native/command-manifest.js";
import { getMcpToolSchemas } from "../chat-native/tool-schemas.js";
import type { OrcCommandPacket } from "./types.js";

export function tokenizeOrcCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new OraculumError(`Unterminated quoted string in orc command: ${input}`);
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function parseOrcCommandLine(input: string, cwd = process.cwd()): OrcCommandPacket {
  return parseOrcCommandArgv(tokenizeOrcCommandLine(input), cwd, input);
}

export function parseOrcCommandArgv(
  argv: string[],
  cwd = process.cwd(),
  rawInput = argv.join(" "),
): OrcCommandPacket {
  const normalized = argv[0] === "orc" ? argv.slice(1) : argv.slice();
  if (normalized.length === 0) {
    throw new OraculumError("Expected an `orc` command but received no command path.");
  }

  const entry = matchManifestEntry(normalized);
  if (!entry) {
    throw new OraculumError(`Unknown orc command: ${rawInput}`);
  }

  const valueTokens = normalized.slice(entry.path.length);
  const request = buildValidatedRequest(entry, valueTokens, cwd);

  return {
    argv: argv.slice(),
    commandLine: rawInput,
    cwd,
    entry,
    request,
    toolId: entry.mcpTool,
  };
}

function matchManifestEntry(tokens: string[]): CommandManifestEntry | undefined {
  return [...oraculumCommandManifest]
    .sort((left, right) => right.path.length - left.path.length)
    .find((entry) => entry.path.every((segment, index) => tokens[index] === segment));
}

function buildValidatedRequest(
  entry: CommandManifestEntry,
  tokens: string[],
  cwd: string,
): Record<string, unknown> {
  const payload = buildRequestPayload(entry, tokens, cwd);
  const schemas = getMcpToolSchemas(entry.mcpTool);
  return schemas.request.parse(payload) as Record<string, unknown>;
}

function buildRequestPayload(
  entry: CommandManifestEntry,
  tokens: string[],
  cwd: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { cwd };
  const positionalArguments = entry.arguments.filter((argument) => argument.positional);
  const optionArguments = new Map(
    entry.arguments
      .filter((argument) => argument.option)
      .map((argument) => [argument.option as string, argument]),
  );

  let positionalIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("--")) {
      const [flag, inlineValue] = splitOptionToken(token);
      const argument = optionArguments.get(flag);
      if (!argument) {
        throw new OraculumError(`Unknown option for \`orc ${entry.path.join(" ")}\`: ${flag}`);
      }

      if (argument.kind === "boolean") {
        payload[argument.name] = inlineValue ? coerceArgumentValue(argument, inlineValue) : true;
        continue;
      }

      const rawValue = inlineValue ?? tokens[index + 1];
      if (!rawValue || inlineValue == null) {
        index += 1;
      }
      if (!rawValue) {
        throw new OraculumError(
          `Missing value for option ${flag} in \`orc ${entry.path.join(" ")}\`.`,
        );
      }

      payload[argument.name] = coerceArgumentValue(argument, rawValue);
      continue;
    }

    const argument = positionalArguments[positionalIndex];
    if (!argument) {
      throw new OraculumError(
        `Unexpected extra argument \`${token}\` for \`orc ${entry.path.join(" ")}\`.`,
      );
    }

    payload[argument.name] = coerceArgumentValue(argument, token);
    positionalIndex += 1;
  }

  for (const argument of positionalArguments) {
    if (argument.required && payload[argument.name] == null) {
      throw new OraculumError(
        `Missing required argument \`${argument.name}\` for \`orc ${entry.path.join(" ")}\`.`,
      );
    }
  }

  return payload;
}

function splitOptionToken(token: string): [string, string | undefined] {
  const separator = token.indexOf("=");
  if (separator === -1) {
    return [token, undefined];
  }

  return [token.slice(0, separator), token.slice(separator + 1)];
}

function coerceArgumentValue(
  argument: CommandArgument,
  rawValue: string,
): boolean | number | string {
  if (argument.kind === "integer") {
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed)) {
      throw new OraculumError(
        `Expected integer for \`${argument.name}\`, received \`${rawValue}\`.`,
      );
    }

    return parsed;
  }

  if (argument.kind === "boolean") {
    if (rawValue === "true") {
      return true;
    }
    if (rawValue === "false") {
      return false;
    }

    throw new OraculumError(`Expected boolean for \`${argument.name}\`, received \`${rawValue}\`.`);
  }

  return rawValue;
}
