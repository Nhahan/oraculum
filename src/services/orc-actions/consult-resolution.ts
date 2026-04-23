import { readdir, readFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import {
  consultationPlanReadinessSchema,
  type ConsultationPlanReadiness,
  type RunManifest,
} from "../../domain/run.js";
import { parseRunManifestArtifact } from "../run-manifest-artifact.js";
import { RunStore } from "../run-store.js";
import { getConsultationPlanReadinessPathForPlan } from "../runs/consultation-plan-artifacts/readiness.js";
import { readConsultationPlanArtifact } from "../task-packets.js";
import { pathExists } from "../project.js";

export type ConsultExecutionTarget =
  | {
      kind: "resume-run";
      runId: string;
    }
  | {
      kind: "task-input";
      taskInput: string;
    };

export async function resolveConsultExecutionTarget(options: {
  cwd: string;
  taskInput?: string;
}): Promise<ConsultExecutionTarget> {
  if (options.taskInput) {
    return {
      kind: "task-input",
      taskInput: options.taskInput,
    };
  }

  const store = new RunStore(options.cwd);
  const manifests = await readPersistedRunManifests(store);
  const running = sortRecentManifests(manifests).find((manifest) => manifest.status === "running");
  if (running) {
    return {
      kind: "resume-run",
      runId: running.id,
    };
  }

  const readyPlanPath = await findLatestReadyConsultationPlanPath(store, manifests);
  if (readyPlanPath) {
    return {
      kind: "task-input",
      taskInput: readyPlanPath,
    };
  }

  throw new OraculumError(
    'No resumable consultation or ready consultation plan found. Start with `orc plan "<task>"`, `orc consult "<task>"`, or `orc consult <consultation-plan-path>`.',
  );
}

async function readPersistedRunManifests(store: RunStore): Promise<RunManifest[]> {
  if (!(await pathExists(store.runsDir))) {
    return [];
  }

  const entries = await readdir(store.runsDir, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = store.getRunPaths(entry.name).manifestPath;
        if (!(await pathExists(manifestPath))) {
          return undefined;
        }

        try {
          return parseRunManifestArtifact(
            JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
          );
        } catch {
          return undefined;
        }
      }),
  );

  return manifests.filter((manifest): manifest is RunManifest => Boolean(manifest));
}

async function findLatestReadyConsultationPlanPath(
  store: RunStore,
  manifests: RunManifest[],
): Promise<string | undefined> {
  const planned = sortRecentManifests(manifests).filter((manifest) => manifest.status === "planned");
  for (const manifest of planned) {
    const planPath = store.getRunPaths(manifest.id).consultationPlanPath;
    if (await isReadyConsultationPlan(planPath, manifest.id)) {
      return planPath;
    }
  }

  return undefined;
}

async function isReadyConsultationPlan(planPath: string, runId: string): Promise<boolean> {
  const consultationPlan = await readConsultationPlanArtifact(planPath).catch(() => undefined);
  if (!consultationPlan || consultationPlan.runId !== runId) {
    return false;
  }

  const readinessPath = getConsultationPlanReadinessPathForPlan(planPath);
  if (!(await pathExists(readinessPath))) {
    return false;
  }

  let readiness: ConsultationPlanReadiness;
  try {
    readiness = consultationPlanReadinessSchema.parse(
      JSON.parse(await readFile(readinessPath, "utf8")) as unknown,
    );
  } catch {
    return false;
  }

  return (
    readiness.runId === runId &&
    readiness.readyForConsult &&
    readiness.status !== "blocked" &&
    readiness.staleBasis !== true &&
    readiness.missingOracleIds.length === 0 &&
    readiness.unresolvedQuestions.length === 0
  );
}

function sortRecentManifests(manifests: RunManifest[]): RunManifest[] {
  return [...manifests].sort((left, right) => {
    const timeDelta = getManifestTimestamp(right) - getManifestTimestamp(left);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return right.id.localeCompare(left.id);
  });
}

function getManifestTimestamp(manifest: RunManifest): number {
  return new Date(manifest.updatedAt ?? manifest.createdAt).getTime();
}
