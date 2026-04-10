import {
  type AgentRunResult,
  type FinalistSummary,
  finalistSummarySchema,
} from "../adapters/types.js";
import type { ManagedTreeRules } from "../domain/config.js";
import type { OracleVerdict } from "../domain/oracle.js";
import type { CandidateManifest } from "../domain/run.js";

import { collectCandidateChangeInsight, emptyChangeInsight } from "./change-insights.js";
import { buildFinalistSummaries } from "./finalists.js";

interface BuildEnrichedFinalistSummariesOptions {
  candidates: CandidateManifest[];
  candidateResults: AgentRunResult[];
  managedTreeRules?: ManagedTreeRules;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}

export async function buildEnrichedFinalistSummaries(
  options: BuildEnrichedFinalistSummariesOptions,
): Promise<FinalistSummary[]> {
  const baseFinalists = buildFinalistSummaries(
    options.candidates,
    options.candidateResults,
    options.verdictsByCandidate,
  );
  const candidateById = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));

  return Promise.all(
    baseFinalists.map(async (finalist) => {
      const candidate = candidateById.get(finalist.candidateId);
      const verdicts = options.verdictsByCandidate.get(finalist.candidateId) ?? [];
      const changeInsight = candidate
        ? await collectCandidateChangeInsight(candidate, {
            ...(options.managedTreeRules ? { rules: options.managedTreeRules } : {}),
          })
        : emptyChangeInsight();

      return finalistSummarySchema.parse({
        ...finalist,
        changedPaths: changeInsight.changedPaths,
        changeSummary: changeInsight.changeSummary,
        witnessRollup: buildWitnessRollup(verdicts),
        repairSummary: {
          attemptCount: candidate?.repairCount ?? 0,
          repairedRounds: candidate?.repairedRounds ?? [],
        },
      });
    }),
  );
}

function buildWitnessRollup(verdicts: OracleVerdict[]): FinalistSummary["witnessRollup"] {
  const repairHints = new Set<string>();
  const riskSummaries = new Set<string>();
  const witnessHighlights: FinalistSummary["witnessRollup"]["keyWitnesses"] = [];
  let witnessCount = 0;
  let warningOrHigherCount = 0;
  let repairableCount = 0;

  for (const verdict of verdicts) {
    if (verdict.status === "repairable") {
      repairableCount += 1;
    }

    if (verdict.severity !== "info") {
      warningOrHigherCount += 1;
      riskSummaries.add(verdict.summary);
    }

    if (verdict.status === "repairable" && verdict.repairHint) {
      repairHints.add(verdict.repairHint);
    }

    for (const witness of verdict.witnesses) {
      witnessCount += 1;
      witnessHighlights.push({
        roundId: verdict.roundId,
        oracleId: verdict.oracleId,
        kind: witness.kind,
        title: witness.title,
        detail: witness.detail,
      });
    }
  }

  witnessHighlights.sort((left, right) => left.title.localeCompare(right.title));

  return {
    witnessCount,
    warningOrHigherCount,
    repairableCount,
    repairHints: [...repairHints],
    riskSummaries: [...riskSummaries],
    keyWitnesses: witnessHighlights.slice(0, 5),
  };
}
