import { extendedScenarios } from "./scenarios/extended.mjs";
import { scenarioGroupA } from "./scenarios/group-a.mjs";
import { scenarioGroupB } from "./scenarios/group-b.mjs";
import { scenarioGroupC } from "./scenarios/group-c.mjs";

export const scenarios = [
  ...scenarioGroupA,
  ...scenarioGroupB,
  ...scenarioGroupC,
  ...extendedScenarios,
];
