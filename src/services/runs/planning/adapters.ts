import type { PlanRunOptions } from "./types.js";

export function buildAdapterFactoryOptions(
  preflight: PlanRunOptions["preflight"],
  autoProfile: PlanRunOptions["autoProfile"],
  defaultTimeoutMs?: number,
): {
  claudeBinaryPath?: string;
  codexBinaryPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
} {
  const options: {
    claudeBinaryPath?: string;
    codexBinaryPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {};

  const claudeBinaryPath = preflight?.claudeBinaryPath ?? autoProfile?.claudeBinaryPath;
  const codexBinaryPath = preflight?.codexBinaryPath ?? autoProfile?.codexBinaryPath;
  const env = preflight?.env ?? autoProfile?.env;
  const timeoutMs = preflight?.timeoutMs ?? autoProfile?.timeoutMs ?? defaultTimeoutMs;

  if (claudeBinaryPath) {
    options.claudeBinaryPath = claudeBinaryPath;
  }
  if (codexBinaryPath) {
    options.codexBinaryPath = codexBinaryPath;
  }
  if (env) {
    options.env = env;
  }
  if (timeoutMs !== undefined) {
    options.timeoutMs = timeoutMs;
  }

  return options;
}
