import type { ComparisonReport } from "./schema.js";

export function countVerdicts(
  verdicts: Array<{
    status: string;
    severity: string;
  }>,
): ComparisonReport["finalists"][number]["verdictCounts"] {
  const counts = {
    pass: 0,
    repairable: 0,
    fail: 0,
    skip: 0,
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };

  for (const verdict of verdicts) {
    if (verdict.status === "pass") {
      counts.pass += 1;
    } else if (verdict.status === "repairable") {
      counts.repairable += 1;
    } else if (verdict.status === "fail") {
      counts.fail += 1;
    } else if (verdict.status === "skip") {
      counts.skip += 1;
    }

    if (verdict.severity === "info") {
      counts.info += 1;
    } else if (verdict.severity === "warning") {
      counts.warning += 1;
    } else if (verdict.severity === "error") {
      counts.error += 1;
    } else if (verdict.severity === "critical") {
      counts.critical += 1;
    }
  }

  return counts;
}
