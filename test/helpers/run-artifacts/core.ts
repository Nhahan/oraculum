import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getRunManifestPath } from "../../../src/core/paths.js";
import type { ProfileRepoSignals } from "../../../src/domain/profile.js";
import type { RunManifest } from "../../../src/domain/run.js";

import { writeJsonArtifact } from "../fs.js";

export function createEmptyProfileRepoSignals(): ProfileRepoSignals {
  return {
    packageManager: "npm",
    scripts: [],
    dependencies: [],
    files: [],
    workspaceRoots: [],
    workspaceMetadata: [],
    notes: [],
    capabilities: [],
    provenance: [],
    commandCatalog: [],
    skippedCommandCandidates: [],
  };
}

export async function ensureRunReportsDir(cwd: string, runId: string): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
}

export async function writeRunManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await ensureRunReportsDir(cwd, manifest.id);
  await writeJsonArtifact(getRunManifestPath(cwd, manifest.id), manifest);
}

export async function writeRawRunManifest(
  cwd: string,
  runId: string,
  manifest: unknown,
): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
  await writeJsonArtifact(getRunManifestPath(cwd, runId), manifest);
}
