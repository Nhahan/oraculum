import { spawn } from "node:child_process";

import { APP_VERSION } from "../../core/constants.js";
import { OraculumError } from "../../core/errors.js";
import { terminateChildProcess } from "../../core/subprocess.js";
import type {
  CodexAppServerTransportResult,
  OfficialHostTransportRunOptions,
  OrcCommandPacket,
} from "./types.js";
import { DEFAULT_OFFICIAL_TRANSPORT_TIMEOUT_MS } from "./types.js";

interface JsonRpcRequest {
  id: string;
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  id: string;
  result: unknown;
}

interface JsonRpcErrorResponse {
  error: unknown;
  id: string | number | null;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcNotification;

export function buildCodexInitializeRequest(id = "initialize"): JsonRpcRequest {
  return {
    id,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      clientInfo: {
        name: "oraculum",
        version: APP_VERSION,
      },
      capabilities: null,
    },
  };
}

export function buildCodexThreadStartRequest(id: string, cwd: string): JsonRpcRequest {
  return {
    id,
    jsonrpc: "2.0",
    method: "thread/start",
    params: { cwd },
  };
}

export function buildCodexMcpToolCallRequest(
  id: string,
  threadId: string,
  packet: OrcCommandPacket,
  server = "orc",
): JsonRpcRequest {
  return {
    id,
    jsonrpc: "2.0",
    method: "mcpServer/tool/call",
    params: {
      threadId,
      server,
      tool: packet.toolId,
      arguments: packet.request,
    },
  };
}

export async function runCodexOfficialTransport(
  packet: OrcCommandPacket,
  options: OfficialHostTransportRunOptions = {},
): Promise<CodexAppServerTransportResult> {
  const command = options.command ?? "codex";
  const commandArgs = options.commandArgs ?? ["app-server", "--listen", "stdio://"];
  const startupTimeoutMs = options.startupTimeoutMs ?? 15_000;
  const transportTimeoutMs = options.transportTimeoutMs ?? DEFAULT_OFFICIAL_TRANSPORT_TIMEOUT_MS;

  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? packet.cwd,
    detached: process.platform !== "win32",
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const pending = new Map<
    string,
    {
      reject: (error: unknown) => void;
      resolve: (value: unknown) => void;
      timeoutId?: NodeJS.Timeout;
    }
  >();
  const startupEvents: Array<{ name: string; status: string }> = [];
  let buffer = "";
  let closeError: OraculumError | undefined;
  let closed = false;

  const failPending = (error: unknown) => {
    for (const deferred of pending.values()) {
      if (deferred.timeoutId) {
        clearTimeout(deferred.timeoutId);
      }
      deferred.reject(error);
    }
    pending.clear();
  };

  const cleanup = () => {
    for (const deferred of pending.values()) {
      if (deferred.timeoutId) {
        clearTimeout(deferred.timeoutId);
      }
    }
    pending.clear();
    if (!child.killed) {
      terminateChildProcess(child, false);
    }
  };

  const request = (message: JsonRpcRequest): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(closeError ?? new OraculumError("Codex app-server is not running."));
        return;
      }
      const timeoutId =
        transportTimeoutMs > 0
          ? setTimeout(() => {
              pending.delete(message.id);
              reject(
                new OraculumError(`Timed out waiting for Codex app-server request ${message.id}.`),
              );
            }, transportTimeoutMs)
          : undefined;
      timeoutId?.unref();
      pending.set(message.id, {
        resolve,
        reject,
        ...(timeoutId ? { timeoutId } : {}),
      });
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) {
          return;
        }
        const pendingRequest = pending.get(message.id);
        if (pendingRequest?.timeoutId) {
          clearTimeout(pendingRequest.timeoutId);
        }
        pending.delete(message.id);
        reject(
          new OraculumError(
            `Failed to write Codex app-server request ${message.id}: ${error.message}`,
          ),
        );
      });
    });

  const waitForServerReady = (server: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + startupTimeoutMs;

      const interval = setInterval(() => {
        if (startupEvents.some((event) => event.name === server && event.status === "ready")) {
          clearInterval(interval);
          resolve();
          return;
        }

        if (startupEvents.some((event) => event.name === server && event.status === "failed")) {
          clearInterval(interval);
          reject(new OraculumError(`Codex app-server reported ${server} MCP startup failure.`));
          return;
        }

        if (closed) {
          clearInterval(interval);
          reject(closeError ?? new OraculumError("Codex app-server exited before startup."));
          return;
        }

        if (Date.now() >= deadline) {
          clearInterval(interval);
          reject(new OraculumError(`Timed out waiting for Codex app-server MCP server ${server}.`));
        }
      }, 100);
    });

  const handleMessage = (message: JsonRpcMessage) => {
    if ("method" in message) {
      if (message.method === "mcpServer/startupStatus/updated") {
        const params = message.params as { name?: string; status?: string } | undefined;
        if (params?.name && params?.status) {
          startupEvents.push({ name: params.name, status: params.status });
        }
      }
      return;
    }

    const entry = message.id != null ? pending.get(String(message.id)) : undefined;
    if (!entry) {
      return;
    }
    pending.delete(String(message.id));
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }

    if ("error" in message) {
      entry.reject(new OraculumError(`Codex app-server request ${message.id} failed.`));
      return;
    }

    entry.resolve(message.result);
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // Ignore non-JSON lines.
      }
    }
  });

  child.stderr.on("data", () => {
    // stderr is noisy on some hosts; rely on request/notification protocol instead.
  });

  child.once("error", (error) => {
    failPending(error);
  });

  child.once("close", (code, signal) => {
    closed = true;
    closeError = new OraculumError(
      signal
        ? `Codex app-server exited via ${signal} before completing the request.`
        : `Codex app-server exited with code ${code ?? 0} before completing the request.`,
    );
    failPending(closeError);
  });

  try {
    await request(buildCodexInitializeRequest("initialize"));
    const threadStart = (await request(
      buildCodexThreadStartRequest("thread-start", packet.cwd),
    )) as { thread?: { id?: string } };
    const threadId = threadStart.thread?.id;
    if (!threadId) {
      throw new OraculumError("Codex app-server did not return a thread id.");
    }

    await waitForServerReady("orc");

    const toolResult = await request(buildCodexMcpToolCallRequest("tool-call", threadId, packet));

    return {
      startupEvents,
      threadId,
      toolResult,
    };
  } finally {
    cleanup();
  }
}
