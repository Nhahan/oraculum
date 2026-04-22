import { beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error plan-lift evidence is authored as an ESM script.
import { runPlanLiftEvidence } from "../../scripts/plan-lift-evidence.mjs";
import * as runDomain from "../../src/domain/run.js";
import * as mcpTools from "../../src/services/mcp-tools.js";
import * as planLiftHarness from "../../src/services/plan-lift-harness.js";
import { PLAN_LIFT_EVIDENCE_HOOK_TIMEOUT_MS } from "./integration.js";

export interface PlanLiftEvidenceResult {
  aggregate: Record<string, number>;
  results: Array<{
    classification: string;
    direct: {
      crownError?: string;
      executedRepoOracleIds?: string[];
      quality: { score: number };
      repairCounts?: Record<string, number>;
      winner: { source: string } | null;
    };
    id: string;
    planned: {
      crownError?: string;
      executedRepoOracleIds?: string[];
      quality: { score: number };
      repairCounts?: Record<string, number>;
      winner: { source: string } | null;
    };
  }>;
  tempRoot: string;
}

export type PlanLiftScenarioResult = PlanLiftEvidenceResult["results"][number];

export function definePlanLiftEvidenceSuite(
  name: string,
  scenarioIds: readonly string[],
  defineAssertions: (findScenario: (id: string) => PlanLiftScenarioResult | undefined) => void,
  options: { minimumLift?: number } = {},
): void {
  describe.sequential(name, () => {
    let evidence: PlanLiftEvidenceResult;

    beforeAll(async () => {
      evidence = (await runPlanLiftEvidence({
        mcpTools,
        planLiftHarness,
        runDomain,
        scenarioIds,
      })) as PlanLiftEvidenceResult;
    }, PLAN_LIFT_EVIDENCE_HOOK_TIMEOUT_MS);

    const findScenario = (id: string) => evidence.results.find((result) => result.id === id);

    it("keeps the validated plan lift baseline for this scenario group", () => {
      expect(evidence.aggregate.lift).toBeGreaterThanOrEqual(
        options.minimumLift ?? scenarioIds.length,
      );
    });

    defineAssertions(findScenario);
  });
}
