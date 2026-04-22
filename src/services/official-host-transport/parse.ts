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
        if (isTaskOnlyPlanningCommand(entry) && removedPlanningOptions.has(flag)) {
          throw new OraculumError(renderUnsupportedPlanningOption(entry, flag));
        }
        throw new OraculumError(`Unknown option for \`orc ${entry.path.join(" ")}\`: ${flag}`);
      }

      if (argument.kind === "boolean") {
        const nextValue = tokens[index + 1];
        if (inlineValue !== undefined) {
          payload[argument.name] = coerceArgumentValue(argument, inlineValue);
        } else if (isBooleanLiteral(nextValue)) {
          payload[argument.name] = coerceArgumentValue(argument, nextValue);
          index += 1;
        } else {
          payload[argument.name] = true;
        }
        continue;
      }

      const hasInlineValue = inlineValue !== undefined;
      const rawValue = hasInlineValue ? inlineValue : tokens[index + 1];
      if (!hasInlineValue) {
        index += 1;
      }
      if (rawValue === undefined || rawValue.length === 0) {
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

    if (argument.variadic) {
      const existing = payload[argument.name];
      const nextValue = coerceArgumentValue(argument, token);
      payload[argument.name] =
        typeof existing === "string" ? `${existing} ${nextValue}` : nextValue;
      continue;
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

function isTaskOnlyPlanningCommand(entry: CommandManifestEntry): boolean {
  return entry.id === "consult" || entry.id === "plan" || entry.id === "draft";
}

const removedPlanningOptions = new Set([
  "--agent",
  "--answer",
  "--candidates",
  "--clarification-answer",
  "--deliberate",
  "--timeout-ms",
]);

function renderUnsupportedPlanningOption(entry: CommandManifestEntry, flag: string): string {
  const command = `orc ${entry.path.join(" ")}`;
  if (flag === "--answer" || flag === "--clarification-answer") {
    return [
      `Unsupported option for \`${command}\`: ${flag}.`,
      "Include the clarification answer directly in the task text and rerun, for example:",
      '`orc plan "add auth. Email/password only; protect /dashboard; no OAuth."`',
    ].join(" ");
  }

  return [
    `Unsupported option for \`${command}\`: ${flag}.`,
    "`orc consult`, `orc plan`, and `orc draft` accept task text only.",
    "Put requirements in the task text or configure advanced controls in `.oraculum/config.json` / `.oraculum/advanced.json`.",
  ].join(" ");
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

function isBooleanLiteral(value: string | undefined): value is "true" | "false" {
  return value === "true" || value === "false";
}
