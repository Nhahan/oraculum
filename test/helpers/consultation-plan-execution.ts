import { writeFile } from "node:fs/promises";

import { getAdvancedConfigPath, getConsultationPlanReadinessPath } from "../../src/core/paths.js";
import { consultationPlanReadinessSchema } from "../../src/domain/run.js";
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

export async function writePlanReadiness(
  cwd: string,
  runId: string,
  overrides: Partial<{
    status: "clear" | "issues" | "blocked";
    readyForConsult: boolean;
    blockers: string[];
    warnings: string[];
    staleBasis: boolean;
    missingOracleIds: string[];
    unresolvedQuestions: string[];
    reviewStatus: "not-run" | "clear" | "issues" | "blocked";
    nextAction: string;
  }> = {},
): Promise<void> {
  await writeFile(
    getConsultationPlanReadinessPath(cwd, runId),
    `${JSON.stringify(
      consultationPlanReadinessSchema.parse({
        runId,
        status: overrides.status ?? "clear",
        readyForConsult: overrides.readyForConsult ?? true,
        blockers: overrides.blockers ?? [],
        warnings: overrides.warnings ?? [],
        staleBasis: overrides.staleBasis ?? false,
        missingOracleIds: overrides.missingOracleIds ?? [],
        unresolvedQuestions: overrides.unresolvedQuestions ?? [],
        reviewStatus: overrides.reviewStatus ?? "not-run",
        nextAction:
          overrides.nextAction ??
          `Execute the planned consultation: \`orc consult .oraculum/runs/${runId}/reports/consultation-plan.json\`.`,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}
