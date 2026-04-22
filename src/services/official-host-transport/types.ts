import type { CommandManifestEntry, McpToolId } from "../../domain/chat-native.js";
import type { Adapter } from "../../domain/config.js";

export const DEFAULT_OFFICIAL_TRANSPORT_TIMEOUT_MS = 30 * 60 * 1000;

export interface OrcCommandPacket {
  argv: string[];
  commandLine: string;
  cwd: string;
  entry: CommandManifestEntry;
  request: Record<string, unknown>;
  toolId: McpToolId;
}

export interface OfficialHostTransportRunOptions {
  command?: string;
  commandArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  transportTimeoutMs?: number;
}

export interface CodexAppServerTransportResult {
  startupEvents: Array<{ name: string; status: string }>;
  threadId: string;
  toolResult: unknown;
}

export interface ClaudeOfficialTransportResult {
  finalResult?: string;
  streamEvents: Array<{ type: string; subtype?: string }>;
  toolResult: unknown;
}

export interface HostTransportCapability {
  available: boolean;
  detail?: string;
  host: Adapter;
}
