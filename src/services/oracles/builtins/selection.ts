import type { EvaluateCandidateRoundOptions, OracleDefinition } from "../shared.js";
import { fastBuiltInOracles } from "./fast.js";
import { impactBuiltInOracles } from "./impact.js";
import { getSelectedPlannedConsultationOracles } from "./planned-consultation.js";

const builtInOracles: OracleDefinition[] = [...fastBuiltInOracles, ...impactBuiltInOracles];

export function getSelectedBuiltInOracles(
  options: EvaluateCandidateRoundOptions,
): OracleDefinition[] {
  return [
    ...builtInOracles.filter((oracle) => oracle.roundId === options.roundId),
    ...getSelectedPlannedConsultationOracles(options),
  ];
}
