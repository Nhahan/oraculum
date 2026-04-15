import { beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error plan-lift evidence is authored as an ESM script.
import { runPlanLiftEvidence } from "../scripts/plan-lift-evidence.mjs";
import * as runDomain from "../src/domain/run.js";
import * as mcpTools from "../src/services/mcp-tools.js";
import * as planLiftHarness from "../src/services/plan-lift-harness.js";

interface PlanLiftEvidenceResult {
  aggregate: Record<string, number>;
  results: Array<{
    classification: string;
    direct: {
      quality: { score: number };
      winner: { source: string } | null;
    };
    id: string;
    planned: {
      quality: { score: number };
      winner: { source: string } | null;
    };
  }>;
  tempRoot: string;
}

describe.sequential("plan lift evidence baseline", () => {
  let evidence: PlanLiftEvidenceResult;

  beforeAll(async () => {
    evidence = (await runPlanLiftEvidence({
      mcpTools,
      planLiftHarness,
      runDomain,
    })) as PlanLiftEvidenceResult;
  }, 180_000);

  it("keeps the validated complex-task lift baseline", () => {
    expect(evidence.aggregate.lift).toBeGreaterThanOrEqual(13);
  });

  it("keeps fallback-policy lift for the staged fallback scenario", () => {
    const scenario = evidence.results.find((result) => result.id === "fallback-policy-stage-guard");

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.winner?.source).toBe("fallback-policy");
    expect(scenario?.planned.winner?.source).toBe("fallback-policy");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });

  it("keeps code-plus-config lift for the runtime bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "code-config-contract-coverage",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });

  it("keeps polyglot lift for the cross-language runtime bundle scenario", () => {
    const scenario = evidence.results.find((result) => result.id === "polyglot-contract-coverage");

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });

  it("keeps python-plus-rust lift for the mixed runtime contract scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "python-rust-contract-coverage",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });
});
