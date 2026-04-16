import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRecurringReason,
  pressureRecurringReasonSchema,
} from "../schema.js";
import { compareOccurrenceThenLatest, isNewerOpenedAt, sortStrings } from "./shared.js";

export function buildRecurringReasons(
  cases: PressureEvidenceCase[],
  getLabel: (item: PressureEvidenceCase) => string,
): PressureRecurringReason[] {
  const grouped = new Map<
    string,
    {
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const label = getLabel(item).trim();
    if (label.length === 0) {
      continue;
    }

    const current = grouped.get(label);
    if (!current) {
      grouped.set(label, {
        kinds: new Set([item.kind]),
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (isNewerOpenedAt(item.openedAt, current.latestOpenedAt)) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.entries()]
    .filter(([, item]) => item.runIds.size >= 2)
    .sort((left, right) =>
      compareOccurrenceThenLatest(
        left[1].runIds.size,
        left[1].latestOpenedAt,
        right[1].runIds.size,
        right[1].latestOpenedAt,
      ),
    )
    .map(([label, item]) =>
      pressureRecurringReasonSchema.parse({
        label,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: sortStrings(item.kinds),
      }),
    );
}
