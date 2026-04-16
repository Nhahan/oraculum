import {
  type PressureEvidenceCase,
  type PressureEvidenceCaseKind,
  type PressureRecentCluster,
  type PressureTrajectoryRun,
  pressureRecentClusterSchema,
} from "./schema.js";

export function buildRecentCluster(
  cases: PressureEvidenceCase[],
  windowDays = 7,
): PressureRecentCluster {
  if (cases.length === 0) {
    return pressureRecentClusterSchema.parse({
      windowDays,
      recentRunCount: 0,
    });
  }

  const [latest] = [...cases].sort(
    (left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime(),
  );
  if (!latest) {
    return pressureRecentClusterSchema.parse({
      windowDays,
      recentRunCount: 0,
    });
  }
  const latestTime = new Date(latest.openedAt).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const runIds = new Set(
    cases
      .filter((item) => latestTime - new Date(item.openedAt).getTime() <= windowMs)
      .map((item) => item.runId),
  );

  return pressureRecentClusterSchema.parse({
    windowDays,
    recentRunCount: runIds.size,
    latestRunId: latest.runId,
    latestOpenedAt: latest.openedAt,
  });
}

export function buildExpectedClarifyFollowUpRunIds(cases: PressureEvidenceCase[]): Set<string> {
  const runIds = new Set<string>();
  const targetGroups = new Map<
    string,
    Array<{ hasClarifyFollowUp: boolean; openedAt: string; runId: string }>
  >();
  const sourceGroups = new Map<
    string,
    Array<{ hasClarifyFollowUp: boolean; openedAt: string; runId: string }>
  >();

  for (const item of cases) {
    if (item.targetArtifactPath) {
      const current = targetGroups.get(item.targetArtifactPath) ?? [];
      current.push({
        runId: item.runId,
        openedAt: item.openedAt,
        hasClarifyFollowUp: Boolean(item.artifactPaths.clarifyFollowUpPath),
      });
      targetGroups.set(item.targetArtifactPath, current);
    }

    const current = sourceGroups.get(item.taskSourcePath) ?? [];
    current.push({
      runId: item.runId,
      openedAt: item.openedAt,
      hasClarifyFollowUp: Boolean(item.artifactPaths.clarifyFollowUpPath),
    });
    sourceGroups.set(item.taskSourcePath, current);
  }

  for (const group of [...targetGroups.values(), ...sourceGroups.values()]) {
    const orderedRuns = [...group]
      .sort(compareRunSequence)
      .filter(
        (entry, index, items) => items.findIndex((item) => item.runId === entry.runId) === index,
      );
    if (orderedRuns.length < 2) {
      continue;
    }
    for (const [index, entry] of orderedRuns.entries()) {
      if (index < 2 || entry.hasClarifyFollowUp) {
        continue;
      }
      runIds.add(entry.runId);
    }
  }

  return runIds;
}

export function calculateDaySpanDays(openedAtValues: string[]): number {
  if (openedAtValues.length < 2) {
    return 0;
  }

  const sorted = [...openedAtValues].sort(
    (left, right) => new Date(left).getTime() - new Date(right).getTime(),
  );
  const [earliestValue] = sorted;
  const latestValue = sorted.at(-1);
  if (!earliestValue || !latestValue) {
    return 0;
  }
  const earliest = new Date(earliestValue).getTime();
  const latest = new Date(latestValue).getTime();
  return Math.max(0, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)));
}

export function detectTrajectoryEscalation(runs: PressureTrajectoryRun[]): boolean {
  let previousSeverity = -1;

  for (const run of runs) {
    const currentSeverity = Math.max(...run.kinds.map(scoreEvidenceCaseKind));
    if (previousSeverity >= 0 && currentSeverity > previousSeverity) {
      return true;
    }
    previousSeverity = currentSeverity;
  }

  return false;
}

export function scoreEvidenceCaseKind(kind: PressureEvidenceCaseKind): number {
  switch (kind) {
    case "clarify-needed":
      return 1;
    case "external-research-required":
      return 2;
    case "low-confidence-recommendation":
      return 1;
    case "second-opinion-disagreement":
      return 2;
    case "finalists-without-recommendation":
      return 2;
    case "manual-crowning-handoff":
      return 2;
    case "judge-abstain":
      return 3;
  }
}

function compareRunSequence(
  left: { openedAt: string; runId: string },
  right: { openedAt: string; runId: string },
): number {
  const leftRunTimestamp = extractRunSequenceTimestamp(left.runId);
  const rightRunTimestamp = extractRunSequenceTimestamp(right.runId);
  if (
    leftRunTimestamp !== undefined &&
    rightRunTimestamp !== undefined &&
    leftRunTimestamp !== rightRunTimestamp
  ) {
    return leftRunTimestamp.localeCompare(rightRunTimestamp);
  }

  const openedAtDelta = new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime();
  if (openedAtDelta !== 0) {
    return openedAtDelta;
  }

  return left.runId.localeCompare(right.runId);
}

function extractRunSequenceTimestamp(runId: string): string | undefined {
  const match = /^run_(\d{14})_[0-9a-f]{8}$/i.exec(runId);
  return match?.[1];
}
