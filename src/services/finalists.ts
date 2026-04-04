import type { AgentRunResult, FinalistSummary } from "../adapters/types.js";
import type { OracleVerdict } from "../domain/oracle.js";
import type { CandidateManifest } from "../domain/run.js";

export function buildFinalistSummaries(
  candidates: CandidateManifest[],
  candidateResults: AgentRunResult[],
  verdictsByCandidate: Map<string, OracleVerdict[]>,
): FinalistSummary[] {
  const resultByCandidate = new Map(candidateResults.map((result) => [result.candidateId, result]));

  return candidates
    .filter((candidate) => candidate.status === "promoted")
    .map((candidate) => {
      const result = resultByCandidate.get(candidate.id);
      return {
        candidateId: candidate.id,
        strategyLabel: candidate.strategyLabel,
        summary: result?.summary ?? "No agent summary captured.",
        artifactKinds: result?.artifacts.map((artifact) => artifact.kind) ?? [],
        verdicts: (verdictsByCandidate.get(candidate.id) ?? []).map((verdict) => ({
          roundId: verdict.roundId,
          oracleId: verdict.oracleId,
          status: verdict.status,
          severity: verdict.severity,
          summary: verdict.summary,
        })),
      };
    });
}
