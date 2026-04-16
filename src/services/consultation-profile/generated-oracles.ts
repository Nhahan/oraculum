import type { RepoOracle } from "../../domain/config.js";
import type { ProfileCommandCandidate } from "../../domain/profile.js";

import { commandExecutionKey } from "./shared.js";

const GENERATED_ORACLE_TIMEOUT_MS = {
  fast: 60_000,
  impact: 5 * 60_000,
  deep: 10 * 60_000,
} as const satisfies Record<ProfileCommandCandidate["roundId"], number>;

export function buildGeneratedOracles(
  selectedCommandIds: string[],
  catalog: ProfileCommandCandidate[],
): RepoOracle[] {
  const byId = new Map(catalog.map((candidate) => [candidate.id, candidate]));
  const oracles: RepoOracle[] = [];
  const seenCommands = new Set<string>();

  for (const commandId of selectedCommandIds) {
    const candidate = byId.get(commandId);
    if (!candidate) {
      continue;
    }

    const commandKey = commandExecutionKey(candidate);
    if (seenCommands.has(commandKey)) {
      continue;
    }
    seenCommands.add(commandKey);

    oracles.push({
      id: candidate.id,
      roundId: candidate.roundId,
      command: candidate.command,
      args: candidate.args,
      invariant: candidate.invariant,
      cwd: "workspace",
      ...(candidate.relativeCwd ? { relativeCwd: candidate.relativeCwd } : {}),
      pathPolicy: candidate.pathPolicy ?? "local-only",
      enforcement: "hard",
      confidence: candidate.roundId === "deep" ? "medium" : "high",
      timeoutMs: GENERATED_ORACLE_TIMEOUT_MS[candidate.roundId],
      ...(candidate.safetyRationale ? { safetyRationale: candidate.safetyRationale } : {}),
      env: {},
    });
  }

  return oracles;
}
