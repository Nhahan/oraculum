import { getHostWrapperAdapter } from "./adapters.js";
import { stripForwardedWrapperSeparator } from "./decision.js";
import { getDirectTransport } from "./transport.js";
import type { HostWrapperRunOptions } from "./types.js";

export async function runHostWrapper(options: HostWrapperRunOptions): Promise<number> {
  const args = stripForwardedWrapperSeparator(options.args);
  const adapter = getHostWrapperAdapter(options.host);
  const hostBinary = resolveWrappedHostBinary(adapter.hostBinary, options.env ?? process.env);

  return await getDirectTransport().run({
    ...options,
    args,
    command: hostBinary,
  });
}

function resolveWrappedHostBinary(defaultBinary: string, env: NodeJS.ProcessEnv): string {
  const explicit = env.ORACULUM_HOST_WRAPPER_REAL_BINARY?.trim();
  if (explicit && isMatchingHostBinary(explicit, defaultBinary)) {
    return explicit;
  }

  return defaultBinary;
}

function isMatchingHostBinary(candidate: string, expectedBinary: string): boolean {
  const normalizedCandidate = candidate.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  return Boolean(normalizedCandidate?.includes(expectedBinary.toLowerCase()));
}
