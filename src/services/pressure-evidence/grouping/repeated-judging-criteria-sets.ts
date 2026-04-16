import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRepeatedJudgingCriteriaSet,
  pressureRepeatedJudgingCriteriaSetSchema,
} from "../schema.js";
import {
  compareOccurrenceThenLatest,
  isNewerOpenedAt,
  sortStrings,
  uniqueSortedStrings,
} from "./shared.js";

export function buildRepeatedJudgingCriteriaSets(
  cases: PressureEvidenceCase[],
): PressureRepeatedJudgingCriteriaSet[] {
  const grouped = new Map<
    string,
    {
      judgingCriteria: string[];
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
      taskTitles: Set<string>;
    }
  >();

  for (const item of cases) {
    const judgingCriteria = uniqueSortedStrings(item.judgingCriteria ?? []);
    if (judgingCriteria.length === 0) {
      continue;
    }

    const key = judgingCriteria.join("\u0000");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        judgingCriteria,
        kinds: new Set([item.kind]),
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runIds: new Set([item.runId]),
        taskTitles: new Set([item.taskTitle]),
      });
      continue;
    }

    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (isNewerOpenedAt(item.openedAt, current.latestOpenedAt)) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) =>
      compareOccurrenceThenLatest(
        left.runIds.size,
        left.latestOpenedAt,
        right.runIds.size,
        right.latestOpenedAt,
      ),
    )
    .map((item) =>
      pressureRepeatedJudgingCriteriaSetSchema.parse({
        judgingCriteria: item.judgingCriteria,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: sortStrings(item.taskTitles),
        kinds: sortStrings(item.kinds),
      }),
    );
}
