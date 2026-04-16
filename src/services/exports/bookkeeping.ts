import { readFile, rm, writeFile } from "node:fs/promises";

import { OraculumError } from "../../core/errors.js";
import {
  defaultProjectConfig,
  type ManagedTreeRules,
  projectConfigSchema,
} from "../../domain/config.js";
import { toCanonicalConsultationProfileSelection } from "../../domain/profile.js";
import {
  type CandidateManifest,
  candidateManifestSchema,
  deriveConsultationOutcomeForManifest,
  type RunManifest,
  runManifestSchema,
} from "../../domain/run.js";
import { loadProjectConfig, pathExists, writeJsonFile } from "../project.js";
import type { RunStore } from "../run-store.js";

import { currentFileContentsMatch, formatUnknownError } from "./shared.js";

export function findExportCandidate(manifest: RunManifest, candidateId: string): CandidateManifest {
  const candidate = manifest.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new OraculumError(
      `Candidate "${candidateId}" does not exist in consultation "${manifest.id}".`,
    );
  }

  if (candidate.status !== "promoted" && candidate.status !== "exported") {
    throw new OraculumError(
      `Candidate "${candidate.id}" is not ready to materialize because its status is "${candidate.status}".`,
    );
  }

  return candidate;
}

export async function readRunManagedTreeRules(
  projectRoot: string,
  manifest: RunManifest,
): Promise<ManagedTreeRules> {
  if (manifest.configPath && (await pathExists(manifest.configPath))) {
    const raw = JSON.parse(await readFile(manifest.configPath, "utf8")) as unknown;
    return projectConfigSchema.parse(raw).managedTree;
  }

  try {
    return (await loadProjectConfig(projectRoot)).managedTree;
  } catch {
    return defaultProjectConfig.managedTree;
  }
}

export async function markCandidateExported(
  store: RunStore,
  manifest: RunManifest,
  candidateId: string,
): Promise<void> {
  const originalCandidate = manifest.candidates.find((candidate) => candidate.id === candidateId);
  const originalCandidateJson = originalCandidate
    ? `${JSON.stringify(originalCandidate, null, 2)}\n`
    : undefined;
  const updatedCandidates = manifest.candidates.map((candidate) =>
    candidate.id === candidateId
      ? candidateManifestSchema.parse({ ...candidate, status: "exported" })
      : candidate,
  );
  const nextManifest = runManifestSchema.parse({
    ...manifest,
    candidates: updatedCandidates,
  });

  const exportedCandidate = updatedCandidates.find((candidate) => candidate.id === candidateId);
  if (!exportedCandidate) {
    return;
  }

  const candidateManifestPath = store.getCandidatePaths(
    manifest.id,
    exportedCandidate.id,
  ).manifestPath;
  const candidateManifestExisted = await pathExists(candidateManifestPath);
  const manifestPath = store.getRunPaths(manifest.id).manifestPath;

  try {
    await writeJsonFile(candidateManifestPath, exportedCandidate);
    await writeJsonFile(manifestPath, {
      ...runManifestSchema.parse({
        ...nextManifest,
        updatedAt: new Date().toISOString(),
        outcome: deriveConsultationOutcomeForManifest(nextManifest),
      }),
      ...(nextManifest.profileSelection
        ? {
            profileSelection: toCanonicalConsultationProfileSelection(
              nextManifest.profileSelection,
            ),
          }
        : {}),
    });
  } catch (error) {
    const restoreFailures: string[] = [];

    try {
      await writeJsonFile(manifestPath, manifest);
    } catch (restoreError) {
      restoreFailures.push(`run manifest (${formatUnknownError(restoreError)})`);
    }

    try {
      if (candidateManifestExisted && originalCandidate && originalCandidateJson) {
        const currentManifestMatchesOriginal =
          (await pathExists(candidateManifestPath)) &&
          (await currentFileContentsMatch(candidateManifestPath, originalCandidateJson));
        if (!currentManifestMatchesOriginal) {
          await rm(candidateManifestPath, { recursive: true, force: true });
          await writeFile(candidateManifestPath, originalCandidateJson, "utf8");
        }
      } else if (!candidateManifestExisted) {
        await rm(candidateManifestPath, { force: true });
      }
    } catch (restoreError) {
      restoreFailures.push(`candidate manifest (${formatUnknownError(restoreError)})`);
    }

    if (restoreFailures.length > 0) {
      throw new OraculumError(
        `Failed to update crowning bookkeeping and restore previous metadata cleanly: ${restoreFailures.join(", ")}.`,
      );
    }

    throw error;
  }
}
