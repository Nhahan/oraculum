import { spawn } from "node:child_process";

import { OraculumError } from "../../core/errors.js";
import { terminateChildProcess } from "../../core/subprocess.js";
import type {
  ClaudeOfficialTransportResult,
  HostTransportCapability,
  OfficialHostTransportRunOptions,
  OrcCommandPacket,
} from "./types.js";
import { DEFAULT_OFFICIAL_TRANSPORT_TIMEOUT_MS } from "./types.js";

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
  const transportTimeoutMs = options.transportTimeoutMs ?? DEFAULT_OFFICIAL_TRANSPORT_TIMEOUT_MS;
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
    detached: process.platform !== "win32",
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
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

  child.stdin.on("error", () => {
    // The process exit path below reports the transport failure.
  });

  const exitCodePromise = new Promise<number>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let killTimeoutId: NodeJS.Timeout | undefined;
    const timeoutId =
      transportTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            if (!child.killed) {
              terminateChildProcess(child, false);
            }
            killTimeoutId = setTimeout(() => {
              if (!child.killed) {
                terminateChildProcess(child, true);
              }
            }, 500).unref();
          }, transportTimeoutMs)
        : undefined;
    timeoutId?.unref();

    const cleanupTimers = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (killTimeoutId) {
        clearTimeout(killTimeoutId);
      }
    };

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimers();
      if (timedOut) {
        reject(new OraculumError("Claude official transport timed out."));
        return;
      }
      if (signal) {
        reject(new OraculumError(`Claude official transport terminated via ${signal}.`));
        return;
      }
      resolve(code ?? 0);
    });
  });

  child.stdin.write(`${JSON.stringify(buildClaudeStreamJsonUserMessage(packet))}\n`);
  child.stdin.end();
  const exitCode = await exitCodePromise;

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
