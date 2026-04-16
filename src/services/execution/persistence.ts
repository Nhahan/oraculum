import { toCanonicalConsultationProfileSelection } from "../../domain/profile.js";
import {
  type CandidateManifest,
  deriveConsultationOutcomeForManifest,
  type RunManifest,
  runManifestSchema,
} from "../../domain/run.js";
import type { RunStore } from "../run-store.js";

export async function writeRunManifest(
  store: RunStore,
  manifest: RunManifest,
): Promise<RunManifest> {
  const updatedAt = new Date().toISOString();
  const persisted = runManifestSchema.parse({
    ...manifest,
    updatedAt,
    outcome: deriveConsultationOutcomeForManifest(manifest),
  });
  await store.writeRunManifest({
    ...persisted,
    ...(persisted.profileSelection
      ? { profileSelection: toCanonicalConsultationProfileSelection(persisted.profileSelection) }
      : {}),
  });
  return persisted;
}

export async function writeCandidateManifest(
  store: RunStore,
  runId: string,
  candidate: CandidateManifest,
): Promise<void> {
  await store.writeCandidateManifest(runId, candidate);
}
