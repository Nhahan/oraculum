import {
  resolveConsultationArtifacts,
  resolveConsultationArtifactsSync,
} from "../../src/services/consultation-artifacts.js";
import { initializeProject } from "../../src/services/project.js";
import { createTempRootHarness, writeJsonArtifact, writeTextArtifact } from "./fs.js";
import {
  ensureRunReportsDir,
  writeComparisonArtifacts as writeSharedComparisonArtifacts,
} from "./run-artifacts.js";

export { writeJsonArtifact, writeTextArtifact };

const tempRootHarness = createTempRootHarness("oraculum-consultation-artifacts-");

export function registerConsultationArtifactsTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createInitializedProject(): Promise<string> {
  const cwd = await tempRootHarness.createTempRoot();
  await initializeProject({ cwd, force: false });
  return cwd;
}

export async function ensureReportsDir(cwd: string, runId: string): Promise<void> {
  await ensureRunReportsDir(cwd, runId);
}

export async function resolveBoth(
  cwd: string,
  runId: string,
  options?: {
    hasExportedCandidate?: boolean;
  },
) {
  return [
    await resolveConsultationArtifacts(cwd, runId, options),
    resolveConsultationArtifactsSync(cwd, runId, options),
  ];
}

export async function writeComparisonArtifacts(cwd: string, runId: string): Promise<void> {
  await ensureReportsDir(cwd, runId);
  await writeSharedComparisonArtifacts(cwd, runId, {
    jsonOverrides: {
      generatedAt: "2026-04-15T00:00:00.000Z",
      finalistCount: 1,
    },
  });
}
