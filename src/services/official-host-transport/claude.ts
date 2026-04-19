import { spawn } from "node:child_process";

import { OraculumError } from "../../core/errors.js";
import type {
  ClaudeOfficialTransportResult,
  HostTransportCapability,
  OfficialHostTransportRunOptions,
  OrcCommandPacket,
} from "./types.js";

export function buildClaudeOfficialTransportPrompt(packet: OrcCommandPacket): string {
  return [
    `Call the MCP tool \`${packet.toolId}\` with the JSON arguments below and return only the tool result.`,
    "",
    "Arguments:",
    "```json",
    JSON.stringify(packet.request, null, 2),
    "```",
  ].join("\n");
}

export function buildClaudeStreamJsonUserMessage(
  packet: OrcCommandPacket,
): Record<string, unknown> {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: buildClaudeOfficialTransportPrompt(packet),
        },
      ],
    },
  };
}

export function detectClaudeStreamJsonCapability(helpOutput: string): HostTransportCapability {
  return {
    available:
      helpOutput.includes("--input-format") &&
      helpOutput.includes("--output-format") &&
      helpOutput.includes("stream-json"),
    detail: "Requires --print --input-format stream-json --output-format stream-json.",
    host: "claude-code",
  };
}

export async function runClaudeOfficialTransport(
  packet: OrcCommandPacket,
  options: OfficialHostTransportRunOptions = {},
): Promise<ClaudeOfficialTransportResult> {
  const command = options.command ?? "claude";
  const commandArgs = options.commandArgs ?? [
    "--print",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
  ];

  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? packet.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const streamEvents: Array<{ type: string; subtype?: string }> = [];
  let buffer = "";
  let finalResult: string | undefined;
  let toolResult: unknown;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
  });

  child.stderr.on("data", () => {
    // verbose mode emits stream output on stdout; ignore stderr noise here.
  });

  child.stdin.write(`${JSON.stringify(buildClaudeStreamJsonUserMessage(packet))}\n`);
  child.stdin.end();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new OraculumError(`Claude official transport terminated via ${signal}.`));
        return;
      }
      resolve(code ?? 0);
    });
  });

  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof parsed.type === "string" ? parsed.type : "unknown";
    const subtype = typeof parsed.subtype === "string" ? parsed.subtype : undefined;
    streamEvents.push(subtype ? { type, subtype } : { type });

    if (type === "user") {
      const message = parsed.message as { content?: Array<Record<string, unknown>> } | undefined;
      const toolResultContent = message?.content?.find(
        (entry) => entry?.type === "tool_result" && typeof entry.content === "string",
      );
      if (toolResultContent && typeof toolResultContent.content === "string") {
        try {
          toolResult = JSON.parse(toolResultContent.content);
        } catch {
          toolResult = toolResultContent.content;
        }
      }
      continue;
    }

    if (type === "result" && typeof parsed.result === "string") {
      finalResult = parsed.result;
    }
  }

  if (exitCode !== 0) {
    throw new OraculumError(`Claude official transport exited with code ${exitCode}.`);
  }

  if (toolResult == null) {
    throw new OraculumError("Claude official transport did not surface an MCP tool result.");
  }

  return {
    ...(finalResult ? { finalResult } : {}),
    streamEvents,
    toolResult,
  };
}
