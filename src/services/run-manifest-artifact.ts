import { type RunManifest, runManifestSchema } from "../domain/run.js";

export function parseRunManifestArtifact(raw: unknown): RunManifest {
  return runManifestSchema.parse(normalizeRunManifestArtifact(raw));
}

function normalizeRunManifestArtifact(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if (raw.candidateCount !== undefined) {
    return raw;
  }

  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    return raw;
  }

  return {
    ...raw,
    candidateCount: raw.candidates.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
