import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureTrajectory,
  pressureTrajectoryRunSchema,
  pressureTrajectorySchema,
} from "../schema.js";
import { calculateDaySpanDays, detectTrajectoryEscalation } from "../shared.js";
import { compareOccurrenceThenLatest, sortStrings } from "./shared.js";

export function buildPressureTrajectories(cases: PressureEvidenceCase[]): PressureTrajectory[] {
  const grouped = new Map<
    string,
    {
      agents: Set<PressureEvidenceCase["agent"]>;
      distinctKinds: Set<PressureEvidenceCaseKind>;
      key: string;
      keyType: "target-artifact" | "task-source";
      latestOpenedAt: string;
      latestRunId: string;
      runs: Map<
        string,
        {
          agent: PressureEvidenceCase["agent"];
          kinds: Set<PressureEvidenceCaseKind>;
          openedAt: string;
          runId: string;
          taskTitle: string;
        }
      >;
    }
  >();

  for (const item of cases) {
    const keyType = item.targetArtifactPath ? "target-artifact" : "task-source";
    const key = item.targetArtifactPath ?? item.taskSourcePath;
    const groupKey = `${keyType}\u0000${key}`;
    const current = grouped.get(groupKey);
    if (!current) {
      grouped.set(groupKey, {
        agents: new Set([item.agent]),
        distinctKinds: new Set([item.kind]),
        key,
        keyType,
        latestOpenedAt: item.openedAt,
        latestRunId: item.runId,
        runs: new Map([
          [
            item.runId,
            {
              agent: item.agent,
              kinds: new Set([item.kind]),
              openedAt: item.openedAt,
              runId: item.runId,
              taskTitle: item.taskTitle,
            },
          ],
        ]),
      });
      continue;
    }

    current.agents.add(item.agent);
    current.distinctKinds.add(item.kind);
    const run = current.runs.get(item.runId);
    if (!run) {
      current.runs.set(item.runId, {
        agent: item.agent,
        kinds: new Set([item.kind]),
        openedAt: item.openedAt,
        runId: item.runId,
        taskTitle: item.taskTitle,
      });
    } else {
      run.kinds.add(item.kind);
    }
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter(
      (item) => item.runs.size >= 2 && (item.distinctKinds.size >= 2 || item.agents.size >= 2),
    )
    .sort((left, right) =>
      compareOccurrenceThenLatest(
        left.runs.size,
        left.latestOpenedAt,
        right.runs.size,
        right.latestOpenedAt,
      ),
    )
    .map((item) => {
      const runs = [...item.runs.values()]
        .sort(
          (left, right) => new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime(),
        )
        .map((run) =>
          pressureTrajectoryRunSchema.parse({
            runId: run.runId,
            openedAt: run.openedAt,
            agent: run.agent,
            taskTitle: run.taskTitle,
            kinds: sortStrings(run.kinds),
          }),
        );
      return pressureTrajectorySchema.parse({
        keyType: item.keyType,
        key: item.key,
        occurrenceCount: item.runs.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        daySpanDays: calculateDaySpanDays(runs.map((run) => run.openedAt)),
        agents: sortStrings(item.agents),
        distinctKinds: sortStrings(item.distinctKinds),
        containsEscalation: detectTrajectoryEscalation(runs),
        runs,
      });
    });
}
