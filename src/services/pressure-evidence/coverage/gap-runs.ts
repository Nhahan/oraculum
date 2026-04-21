import { normalizeConsultationScopePath } from "../../consultation-artifacts.js";
import { RunStore } from "../../run-store.js";
import type {
  PressureCoverageGapRun,
  PressureEvidenceCase,
  PressureEvidenceCaseKind,
  PressureMissingArtifactKind,
} from "../schema.js";
import {
  pressureCoverageGapRunSchema,
  pressureMissingArtifactBreakdownSchema,
} from "../schema.js";

export function buildCoverageGapRuns(
  projectRoot: string,
  cases: PressureEvidenceCase[],
  getMissingArtifactKinds: (item: PressureEvidenceCase) => PressureMissingArtifactKind[],
): PressureCoverageGapRun[] {
  const store = new RunStore(projectRoot);
  const grouped = new Map<
    string,
    {
      agent: PressureEvidenceCase["agent"];
      consultationPath: string;
      kinds: Set<PressureEvidenceCaseKind>;
      missingArtifactKinds: Set<PressureMissingArtifactKind>;
      openedAt: string;
      runId: string;
      targetArtifactPath?: string;
      taskSourceKind: PressureEvidenceCase["taskSourceKind"];
      taskSourcePath: string;
      taskTitle: string;
    }
  >();

  for (const item of cases) {
    const missingArtifactKinds = getMissingArtifactKinds(item);
    if (missingArtifactKinds.length === 0) {
      continue;
    }

    const current = grouped.get(item.runId);
    if (!current) {
      grouped.set(item.runId, {
        agent: item.agent,
        consultationPath: item.consultationPath,
        kinds: new Set([item.kind]),
        missingArtifactKinds: new Set(missingArtifactKinds),
        openedAt: item.openedAt,
        runId: item.runId,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        taskTitle: item.taskTitle,
      });
      continue;
    }

    current.kinds.add(item.kind);
    for (const missingArtifactKind of missingArtifactKinds) {
      current.missingArtifactKinds.add(missingArtifactKind);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
    .map((item) =>
      pressureCoverageGapRunSchema.parse({
        runId: item.runId,
        openedAt: item.openedAt,
        agent: item.agent,
        taskTitle: item.taskTitle,
        taskSourceKind: item.taskSourceKind,
        taskSourcePath: item.taskSourcePath,
        ...(item.targetArtifactPath ? { targetArtifactPath: item.targetArtifactPath } : {}),
        consultationPath: item.consultationPath,
        manifestPath: normalizeConsultationScopePath(
          projectRoot,
          store.getRunPaths(item.runId).manifestPath,
        ),
        kinds: [...item.kinds].sort((left, right) => left.localeCompare(right)),
        missingArtifactKinds: [...item.missingArtifactKinds].sort((left, right) =>
          left.localeCompare(right),
        ),
      }),
    );
}

export function buildMissingArtifactBreakdown(
  gapRuns: PressureCoverageGapRun[],
): Array<ReturnType<typeof pressureMissingArtifactBreakdownSchema.parse>> {
  const grouped = new Map<PressureMissingArtifactKind, Set<string>>();

  for (const item of gapRuns) {
    for (const missingArtifactKind of item.missingArtifactKinds) {
      const current = grouped.get(missingArtifactKind);
      if (!current) {
        grouped.set(missingArtifactKind, new Set([item.runId]));
        continue;
      }

      current.add(item.runId);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].size !== left[1].size) {
        return right[1].size - left[1].size;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([artifactKind, runIds]) =>
      pressureMissingArtifactBreakdownSchema.parse({
        artifactKind,
        consultationCount: runIds.size,
      }),
    );
}
