import type { Adapter } from "../../domain/config.js";

export interface HostWrapperFilterState {
  pendingOrcCommand: boolean;
  suppressTreeDetail: boolean;
}

export interface HostWrapperLineDecision {
  keep: boolean;
}

export interface HostWrapperAdapter {
  directPassThroughFlags: Set<string>;
  directPassThroughSubcommands: Set<string>;
  host: Adapter;
  hostBinary: string;
  shouldSuppressLine(line: string, state: HostWrapperFilterState): HostWrapperLineDecision;
}

export interface HostWrapperShellInstallResult {
  rcPath?: string;
  snippetPath: string;
}

export interface HostWrapperShellInvocation {
  args: string[];
  command: string;
}

export interface HostWrapperRunOptions {
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  host: Adapter;
}

export interface HostWrapperTransportOptions {
  args: string[];
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  host: Adapter;
}

export interface HostWrapperTransport {
  id: string;
  isAvailable?(): Promise<boolean> | boolean;
  run(options: HostWrapperTransportOptions): Promise<number>;
}
