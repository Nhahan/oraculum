import type { OracleVerdict } from "../../domain/oracle.js";
import type { CandidateSelectionMetrics } from "./shared.js";

export function recordVerdictMetrics(
  metricsByCandidate: Map<string, CandidateSelectionMetrics>,
  candidateId: string,
  verdicts: OracleVerdict[],
): void {
  const metrics = metricsByCandidate.get(candidateId);
  if (!metrics) {
    return;
  }

  for (const verdict of verdicts) {
    if (verdict.status === "pass") {
      metrics.passCount += 1;
    } else if (verdict.status === "repairable") {
      metrics.repairableCount += 1;
    }

    if (verdict.severity === "warning") {
      metrics.warningCount += 1;
    } else if (verdict.severity === "error") {
      metrics.errorCount += 1;
    } else if (verdict.severity === "critical") {
      metrics.criticalCount += 1;
    }
  }
}
