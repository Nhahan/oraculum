import type { RunManifest } from "../../domain/run.js";
import { RunStore } from "../run-store.js";

export async function readRunManifest(cwd: string, runId: string): Promise<RunManifest> {
  return new RunStore(cwd).readRunManifest(runId);
}

export async function readLatestRunManifest(cwd: string): Promise<RunManifest> {
  const store = new RunStore(cwd);
  return store.readRunManifest(await store.readLatestRunId());
}

export async function readLatestRunId(cwd: string): Promise<string> {
  return new RunStore(cwd).readLatestRunId();
}

export async function readLatestExportableRunId(cwd: string): Promise<string> {
  return new RunStore(cwd).readLatestExportableRunId();
}

export async function writeLatestRunState(projectRoot: string, runId: string): Promise<void> {
  await new RunStore(projectRoot).writeLatestRunState(runId);
}

export async function writeLatestExportableRunState(
  projectRoot: string,
  runId: string,
): Promise<void> {
  await new RunStore(projectRoot).writeLatestExportableRunState(runId);
}
