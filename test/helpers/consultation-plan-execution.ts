import { writeFile } from "node:fs/promises";

import { getAdvancedConfigPath } from "../../src/core/paths.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-consultation-plan-");
tempRootHarness.registerCleanup();

export async function createTempProject(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function writeAdvancedConfig(
  cwd: string,
  overrides: {
    oracles?: unknown[];
    repair?: unknown;
    rounds?: unknown[];
    strategies?: unknown[];
  },
): Promise<void> {
  await writeFile(
    getAdvancedConfigPath(cwd),
    `${JSON.stringify(
      {
        version: 1,
        ...(overrides.repair ? { repair: overrides.repair } : {}),
        ...(overrides.strategies ? { strategies: overrides.strategies } : {}),
        ...(overrides.rounds ? { rounds: overrides.rounds } : {}),
        ...(overrides.oracles ? { oracles: overrides.oracles } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function createOracle(options: {
  id: string;
  roundId: "fast" | "impact" | "deep";
  command: string;
  args: string[];
  invariant: string;
}) {
  return {
    id: options.id,
    roundId: options.roundId,
    command: options.command,
    args: options.args,
    invariant: options.invariant,
    cwd: "workspace",
    enforcement: "hard",
    confidence: "high",
  };
}
