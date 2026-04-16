import {
  type PressureAgentBreakdown,
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRecurringReason,
  type PressureRepeatedJudgingCriteriaSet,
  type PressureRepeatedSource,
  type PressureRepeatedStrategySet,
  type PressureRepeatedTarget,
  type PressureRepeatedTask,
  type PressureTrajectory,
  pressureAgentBreakdownSchema,
  pressureRecurringReasonSchema,
  pressureRepeatedJudgingCriteriaSetSchema,
  pressureRepeatedSourceSchema,
  pressureRepeatedStrategySetSchema,
  pressureRepeatedTargetSchema,
  pressureRepeatedTaskSchema,
  pressureTrajectoryRunSchema,
  pressureTrajectorySchema,
} from "./schema.js";
import { calculateDaySpanDays, detectTrajectoryEscalation } from "./shared.js";

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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      pressureRepeatedTaskSchema.parse({
        taskTitle: item.taskTitle,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.entries()]
    .filter(([, item]) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right[1].runIds.size !== left[1].runIds.size) {
        return right[1].runIds.size - left[1].runIds.size;
      }
      return (
        new Date(right[1].latestOpenedAt).getTime() - new Date(left[1].latestOpenedAt).getTime()
      );
    })
    .map(([targetArtifactPath, item]) =>
      pressureRepeatedTargetSchema.parse({
        targetArtifactPath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.taskSourceKind = item.taskSourceKind;
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      pressureRepeatedSourceSchema.parse({
        taskSourceKind: item.taskSourceKind,
        taskSourceKinds: [...item.taskSourceKinds].sort((left, right) => left.localeCompare(right)),
        taskSourcePath: item.taskSourcePath,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.entries()]
    .filter(([, item]) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right[1].runIds.size !== left[1].runIds.size) {
        return right[1].runIds.size - left[1].runIds.size;
      }
      return (
        new Date(right[1].latestOpenedAt).getTime() - new Date(left[1].latestOpenedAt).getTime()
      );
    })
    .map(([label, item]) =>
      pressureRecurringReasonSchema.parse({
        label,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

export function buildAgentBreakdown(cases: PressureEvidenceCase[]): PressureAgentBreakdown[] {
  const grouped = new Map<
    PressureEvidenceCase["agent"],
    {
      caseCount: number;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const current = grouped.get(item.agent);
    if (!current) {
      grouped.set(item.agent, {
        caseCount: 1,
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.caseCount += 1;
    current.runIds.add(item.runId);
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].caseCount !== left[1].caseCount) {
        return right[1].caseCount - left[1].caseCount;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([agent, item]) =>
      pressureAgentBreakdownSchema.parse({
        agent,
        caseCount: item.caseCount,
        consultationCount: item.runIds.size,
      }),
    );
}

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
    .sort((left, right) => {
      if (right.runs.size !== left.runs.size) {
        return right.runs.size - left.runs.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
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
            kinds: [...run.kinds].sort((left, right) => left.localeCompare(right)),
          }),
        );
      return pressureTrajectorySchema.parse({
        keyType: item.keyType,
        key: item.key,
        occurrenceCount: item.runs.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        daySpanDays: calculateDaySpanDays(runs.map((run) => run.openedAt)),
        agents: [...item.agents].sort((left, right) => left.localeCompare(right)),
        distinctKinds: [...item.distinctKinds].sort((left, right) => left.localeCompare(right)),
        containsEscalation: detectTrajectoryEscalation(runs),
        runs,
      });
    });
}

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
    const strategyLabels = [...new Set(item.candidateStrategyLabels)].sort((left, right) =>
      left.localeCompare(right),
    );
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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      pressureRepeatedStrategySetSchema.parse({
        strategyLabels: item.strategyLabels,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}

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
    const judgingCriteria = [...new Set(item.judgingCriteria ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
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
    if (new Date(item.openedAt).getTime() > new Date(current.latestOpenedAt).getTime()) {
      current.latestOpenedAt = item.openedAt;
      current.latestRunId = item.runId;
    }
  }

  return [...grouped.values()]
    .filter((item) => item.runIds.size >= 2)
    .sort((left, right) => {
      if (right.runIds.size !== left.runIds.size) {
        return right.runIds.size - left.runIds.size;
      }
      return new Date(right.latestOpenedAt).getTime() - new Date(left.latestOpenedAt).getTime();
    })
    .map((item) =>
      pressureRepeatedJudgingCriteriaSetSchema.parse({
        judgingCriteria: item.judgingCriteria,
        occurrenceCount: item.runIds.size,
        latestRunId: item.latestRunId,
        latestOpenedAt: item.latestOpenedAt,
        taskTitles: [...item.taskTitles].sort((left, right) => left.localeCompare(right)),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
      }),
    );
}
