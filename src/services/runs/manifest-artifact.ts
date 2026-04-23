import { type RunManifest, runManifestSchema } from "../../domain/run.js";

export function parseRunManifestArtifact(raw: unknown): RunManifest {
  return runManifestSchema.parse(raw);
}
