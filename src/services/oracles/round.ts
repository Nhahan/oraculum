import type { OracleVerdict, Witness } from "../../domain/oracle.js";
import { getSelectedBuiltInOracles } from "./builtins.js";
import { evaluateRepoOracle } from "./repo-local.js";
import type { EvaluateCandidateRoundOptions, EvaluateCandidateRoundResult } from "./shared.js";

export async function evaluateCandidateRound(
  options: EvaluateCandidateRoundOptions,
): Promise<EvaluateCandidateRoundResult> {
  if (options.roundId !== "fast" && options.result.status !== "completed") {
    return {
      survives: false,
      verdicts: [],
      witnesses: [],
    };
  }

  const verdicts: OracleVerdict[] = [];
  const witnesses: Witness[] = [];

  const selectedBuiltIns = getSelectedBuiltInOracles(options);
  for (const oracle of selectedBuiltIns) {
    const evaluation = await oracle.evaluate(options);
    verdicts.push(evaluation.verdict);
    witnesses.push(...evaluation.witnesses);
  }

  const selectedRepoOracles = options.projectConfig.oracles.filter(
    (oracle) => oracle.roundId === options.roundId,
  );
  if (options.result.status === "completed") {
    for (const oracle of selectedRepoOracles) {
      const evaluation = await evaluateRepoOracle(options, oracle);
      verdicts.push(evaluation.verdict);
      witnesses.push(...evaluation.witnesses);
    }
  }

  return {
    survives: verdicts.every((verdict) => verdict.status === "pass" || verdict.status === "skip"),
    verdicts,
    witnesses,
  };
}
