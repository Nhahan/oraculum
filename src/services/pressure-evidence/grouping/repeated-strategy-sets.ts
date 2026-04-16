import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRepeatedStrategySet,
  pressureRepeatedStrategySetSchema,
} from "../schema.js";
import {
  compareOccurrenceThenLatest,
  isNewerOpenedAt,
  sortStrings,
  uniqueSortedStrings,
} from "./shared.js";

export function buildRepeatedStrategySets(
  cases: PressureEvidenceCase[],
): PressureRepeatedStrategySet[] {
  const grouped = new Map<
    string,
    {
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
      strategyLabels: string[];
      taskTitles: Set<string>;
    }
  >();

  for (const item of cases) {
    const strategyLabels = uniqueSortedStrings(item.candidateStrategyLabels);
    if (strategyLabels.length === 0) {
      continue;
    }

    const key = strategyLabels.join("\u0000");
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        kinds: new Set([item.kind]),
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runIds: new Set([item.runId]),
        strategyLabels,
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
      pressureRepeatedStrategySetSchema.parse({
        strategyLabels: item.strategyLabels,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: sortStrings(item.taskTitles),
        kinds: sortStrings(item.kinds),
      }),
    );
}
