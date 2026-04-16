import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRepeatedTarget,
  pressureRepeatedTargetSchema,
} from "../schema.js";
import { compareOccurrenceThenLatest, isNewerOpenedAt, sortStrings } from "./shared.js";

export function buildRepeatedTargets(cases: PressureEvidenceCase[]): PressureRepeatedTarget[] {
  const grouped = new Map<
    string,
    {
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
      taskTitles: Set<string>;
    }
  >();

  for (const item of cases) {
    if (!item.targetArtifactPath) {
      continue;
    }

    const current = grouped.get(item.targetArtifactPath);
    if (!current) {
      grouped.set(item.targetArtifactPath, {
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
    .map(([targetArtifactPath, item]) =>
      pressureRepeatedTargetSchema.parse({
        targetArtifactPath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: sortStrings(item.taskTitles),
        kinds: sortStrings(item.kinds),
      }),
    );
}
