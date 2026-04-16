import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRepeatedTask,
  pressureRepeatedTaskSchema,
} from "../schema.js";
import { compareOccurrenceThenLatest, isNewerOpenedAt, sortStrings } from "./shared.js";

export function buildRepeatedTasks(cases: PressureEvidenceCase[]): PressureRepeatedTask[] {
  const grouped = new Map<
    string,
    {
      kinds: Set<PressureEvidenceCaseKind>;
      latestOpenedAt: string;
      latestRunId: string;
      runIds: Set<string>;
      targetArtifactPath?: string;
      taskTitle: string;
    }
  >();

  for (const item of cases) {
    const key = `${item.taskTitle}\u0000${item.targetArtifactPath ?? ""}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        kinds: new Set([item.kind]),
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runIds: new Set([item.runId]),
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        taskTitle: item.taskTitle,
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
      pressureRepeatedTaskSchema.parse({
        taskTitle: item.taskTitle,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: sortStrings(item.kinds),
      }),
    );
}
