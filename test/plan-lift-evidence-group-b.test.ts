import { expect, it } from "vitest";

import { definePlanLiftEvidenceSuite } from "./helpers/plan-lift-evidence.js";

const baselineScenarioGroupB = [
  "package-oracle-code-test-contract",
  "api-schema-reviewability-bias",
  "project-oracle-api-schema-reviewability",
  "workspace-oracle-package-config-contract",
  "workspace-oracle-package-config-reviewability",
] as const;

definePlanLiftEvidenceSuite(
  "plan lift evidence baseline > group B",
  baselineScenarioGroupB,
  (findScenario) => {
    it("keeps package-oracle lift for the implementation and regression bundle scenario", () => {
      const scenario = findScenario("package-oracle-code-test-contract");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
      expect(scenario?.direct.executedRepoOracleIds).toContain("auth-runtime-impact");
      expect(scenario?.planned.executedRepoOracleIds).toContain("auth-runtime-impact");
    });

    it("keeps api-plus-schema lift for the reviewable handler bundle scenario", () => {
      const scenario = findScenario("api-schema-reviewability-bias");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });

    it("keeps project-oracle lift for the handler and schema bundle scenario", () => {
      const scenario = findScenario("project-oracle-api-schema-reviewability");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
      expect(scenario?.direct.executedRepoOracleIds).toContain("session-api-impact");
      expect(scenario?.planned.executedRepoOracleIds).toContain("session-api-impact");
    });

    it("keeps workspace-oracle lift for the billing package runtime and config contract scenario", () => {
      const scenario = findScenario("workspace-oracle-package-config-contract");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
      expect(scenario?.direct.executedRepoOracleIds).toContain("billing-runtime-workspace");
      expect(scenario?.planned.executedRepoOracleIds).toContain("billing-runtime-workspace");
    });

    it("keeps workspace-oracle reviewability lift for the billing package runtime bundle scenario", () => {
      const scenario = findScenario("workspace-oracle-package-config-reviewability");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
      expect(scenario?.direct.executedRepoOracleIds).toContain("billing-runtime-workspace");
      expect(scenario?.planned.executedRepoOracleIds).toContain("billing-runtime-workspace");
    });
  },
);
