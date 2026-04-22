import { expect, it } from "vitest";

import { definePlanLiftEvidenceSuite } from "./helpers/plan-lift-evidence.js";

const baselineScenarioGroupC = [
  "dual-oracle-migration-rollback-reviewability",
  "package-script-project-oracle-reviewability",
  "package-script-fallback-stage-guard",
  "package-script-repair-stage-guard",
] as const;

definePlanLiftEvidenceSuite(
  "plan lift evidence baseline > group C",
  baselineScenarioGroupC,
  (findScenario) => {
    it("keeps dual-oracle lift for the migration runtime and rollback bundle scenario", () => {
      const scenario = findScenario("dual-oracle-migration-rollback-reviewability");

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
      const scenario = findScenario("package-script-project-oracle-reviewability");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
      expect(scenario?.direct.executedRepoOracleIds).toContain("workspace-session-test");
      expect(scenario?.planned.executedRepoOracleIds).toContain("workspace-session-test");
      expect(scenario?.direct.executedRepoOracleIds).toContain("release-rollback-impact");
      expect(scenario?.planned.executedRepoOracleIds).toContain("release-rollback-impact");
    });

    it("blocks package-script fallback crown for the staged release bundle scenario", () => {
      const scenario = findScenario("package-script-fallback-stage-guard");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("invalid");
      expect(scenario?.direct.winner?.source).toBe("fallback-policy");
      expect(scenario?.planned.winner?.source).toBe("fallback-policy");
      expect(scenario?.direct.crownError).toContain("fallback-policy");
      expect(scenario?.planned.crownError).toContain("fallback-policy");
      expect(scenario?.direct.executedRepoOracleIds).toContain("workspace-session-test");
      expect(scenario?.planned.executedRepoOracleIds).toContain("workspace-session-test");
      expect(scenario?.direct.executedRepoOracleIds).toContain("release-rollback-impact");
      expect(scenario?.planned.executedRepoOracleIds).toContain("release-rollback-impact");
    });

    it("keeps package-script repair lift for the staged release bundle scenario", () => {
      const scenario = findScenario("package-script-repair-stage-guard");

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
  },
  { minimumLift: baselineScenarioGroupC.length - 1 },
);
