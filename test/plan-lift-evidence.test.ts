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
      executedRepoOracleIds?: string[];
      quality: { score: number };
      repairCounts?: Record<string, number>;
      winner: { source: string } | null;
    };
    id: string;
    planned: {
      executedRepoOracleIds?: string[];
      quality: { score: number };
      repairCounts?: Record<string, number>;
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
    expect(evidence.aggregate.lift).toBeGreaterThanOrEqual(23);
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

  it("keeps code-plus-test lift for the implementation and regression bundle scenario", () => {
    const scenario = evidence.results.find((result) => result.id === "code-test-contract-coverage");

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });

  it("keeps package-oracle lift for the implementation and regression bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "package-oracle-code-test-contract",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("auth-runtime-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("auth-runtime-impact");
  });

  it("keeps api-plus-schema lift for the reviewable handler bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "api-schema-reviewability-bias",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
  });

  it("keeps project-oracle lift for the handler and schema bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "project-oracle-api-schema-reviewability",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("session-api-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("session-api-impact");
  });

  it("keeps workspace-oracle lift for the billing package runtime and config contract scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "workspace-oracle-package-config-contract",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("billing-runtime-workspace");
    expect(scenario?.planned.executedRepoOracleIds).toContain("billing-runtime-workspace");
  });

  it("keeps workspace-oracle reviewability lift for the billing package runtime bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "workspace-oracle-package-config-reviewability",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("billing-runtime-workspace");
    expect(scenario?.planned.executedRepoOracleIds).toContain("billing-runtime-workspace");
  });

  it("keeps dual-oracle lift for the migration runtime and rollback bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "dual-oracle-migration-rollback-reviewability",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("payments-runtime-workspace");
    expect(scenario?.planned.executedRepoOracleIds).toContain("payments-runtime-workspace");
    expect(scenario?.direct.executedRepoOracleIds).toContain("migration-rollback-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("migration-rollback-impact");
  });

  it("keeps package-script plus project-oracle lift for the release bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "package-script-project-oracle-reviewability",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.planned.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.direct.executedRepoOracleIds).toContain("release-rollback-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("release-rollback-impact");
  });

  it("keeps package-script fallback lift for the staged release bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "package-script-fallback-stage-guard",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.winner?.source).toBe("fallback-policy");
    expect(scenario?.planned.winner?.source).toBe("fallback-policy");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.planned.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.direct.executedRepoOracleIds).toContain("release-rollback-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("release-rollback-impact");
  });

  it("keeps package-script repair lift for the staged release bundle scenario", () => {
    const scenario = evidence.results.find(
      (result) => result.id === "package-script-repair-stage-guard",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.classification).toBe("lift");
    expect(scenario?.direct.quality.score).toBe(1);
    expect(scenario?.planned.quality.score).toBe(3);
    expect(scenario?.direct.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.planned.executedRepoOracleIds).toContain("workspace-session-test");
    expect(scenario?.direct.executedRepoOracleIds).toContain("release-rollback-impact");
    expect(scenario?.planned.executedRepoOracleIds).toContain("release-rollback-impact");
    expect(scenario?.direct.executedRepoOracleIds).toContain("release-review-note");
    expect(scenario?.planned.executedRepoOracleIds).toContain("release-review-note");
    expect(scenario?.direct.repairCounts?.["cand-01"]).toBe(1);
    expect(scenario?.planned.repairCounts?.["cand-01"]).toBe(1);
  });
});
