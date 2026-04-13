import {
  deriveConsultationOutcomeForManifest,
  type RunManifest,
  runManifestSchema,
} from "../domain/run.js";

export function parseRunManifestArtifact(raw: unknown): RunManifest {
  return runManifestSchema.parse(normalizeRunManifestArtifact(raw));
}

function normalizeRunManifestArtifact(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if (!Array.isArray(raw.candidates)) {
    return raw;
  }

  const normalized: Record<string, unknown> = {
    ...raw,
    ...(raw.candidateCount !== undefined
      ? {}
      : { candidateCount: Array.isArray(raw.candidates) ? raw.candidates.length : 0 }),
    ...(raw.updatedAt === undefined && typeof raw.createdAt === "string"
      ? { updatedAt: raw.createdAt }
      : {}),
  };

  if (normalized.outcome !== undefined || typeof normalized.status !== "string") {
    return normalized;
  }

  return {
    ...normalized,
    outcome: deriveConsultationOutcomeForManifest({
      status: normalized.status as RunManifest["status"],
      candidates: normalized.candidates as RunManifest["candidates"],
      rounds: Array.isArray(normalized.rounds) ? (normalized.rounds as RunManifest["rounds"]) : [],
      ...(isProfileSelectionRecord(normalized.profileSelection)
        ? {
            profileSelection: {
              missingCapabilities: Array.isArray(normalized.profileSelection.missingCapabilities)
                ? (normalized.profileSelection.missingCapabilities as string[])
                : [],
              oracleIds: Array.isArray(normalized.profileSelection.oracleIds)
                ? (normalized.profileSelection.oracleIds as string[])
                : [],
            },
          }
        : {}),
      ...(isRecommendedWinnerRecord(normalized.recommendedWinner)
        ? {
            recommendedWinner: {
              candidateId: normalized.recommendedWinner.candidateId as string,
            },
          }
        : {}),
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileSelectionRecord(value: unknown): value is {
  missingCapabilities?: string[];
  oracleIds?: string[];
} {
  return isRecord(value);
}

function isRecommendedWinnerRecord(value: unknown): value is { candidateId: string } {
  return isRecord(value) && typeof value.candidateId === "string";
}
