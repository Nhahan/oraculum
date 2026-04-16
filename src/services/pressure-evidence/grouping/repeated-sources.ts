import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRepeatedSource,
  pressureRepeatedSourceSchema,
} from "../schema.js";
import { compareOccurrenceThenLatest, isNewerOpenedAt, sortStrings } from "./shared.js";

export function buildRepeatedSources(cases: PressureEvidenceCase[]): PressureRepeatedSource[] {
  const grouped = new Map<
    string,
    {
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
      taskSourceKind: PressureEvidenceCase["taskSourceKind"];
      taskSourceKinds: Set<PressureEvidenceCase["taskSourceKind"]>;
      taskSourcePath: string;
      taskTitles: Set<string>;
    }
  >();

  for (const item of cases) {
    const key = item.taskSourcePath;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        kinds: new Set([item.kind]),
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runIds: new Set([item.runId]),
        taskSourceKind: item.taskSourceKind,
        taskSourceKinds: new Set([item.taskSourceKind]),
        taskSourcePath: item.taskSourcePath,
        taskTitles: new Set([item.taskTitle]),
      });
      continue;
    }

    current.taskSourceKinds.add(item.taskSourceKind);
    current.taskTitles.add(item.taskTitle);
    current.kinds.add(item.kind);
    current.runIds.add(item.runId);
    if (isNewerOpenedAt(item.openedAt, current.latestOpenedAt)) {
      current.taskSourceKind = item.taskSourceKind;
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
      pressureRepeatedSourceSchema.parse({
        taskSourceKind: item.taskSourceKind,
        taskSourceKinds: sortStrings(item.taskSourceKinds),
        taskSourcePath: item.taskSourcePath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: sortStrings(item.taskTitles),
        kinds: sortStrings(item.kinds),
      }),
    );
}
