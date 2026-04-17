import { expect, it } from "vitest";

import { definePlanLiftEvidenceSuite } from "./helpers/plan-lift-evidence.js";

const baselineScenarioGroupA = [
  "fallback-policy-stage-guard",
  "code-config-contract-coverage",
  "polyglot-contract-coverage",
  "python-rust-contract-coverage",
  "code-test-contract-coverage",
] as const;

definePlanLiftEvidenceSuite(
  "plan lift evidence baseline > group A",
  baselineScenarioGroupA,
  (findScenario) => {
    it("keeps fallback-policy lift for the staged fallback scenario", () => {
      const scenario = findScenario("fallback-policy-stage-guard");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.winner?.source).toBe("fallback-policy");
      expect(scenario?.planned.winner?.source).toBe("fallback-policy");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });

    it("keeps code-plus-config lift for the runtime bundle scenario", () => {
      const scenario = findScenario("code-config-contract-coverage");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });

    it("keeps polyglot lift for the cross-language runtime bundle scenario", () => {
      const scenario = findScenario("polyglot-contract-coverage");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });

    it("keeps python-plus-rust lift for the mixed runtime contract scenario", () => {
      const scenario = findScenario("python-rust-contract-coverage");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });

    it("keeps code-plus-test lift for the implementation and regression bundle scenario", () => {
      const scenario = findScenario("code-test-contract-coverage");

      expect(scenario).toBeDefined();
      expect(scenario?.classification).toBe("lift");
      expect(scenario?.direct.quality.score).toBe(1);
      expect(scenario?.planned.quality.score).toBe(3);
    });
  },
);
