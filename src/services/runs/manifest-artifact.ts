import {
  buildBlockedPreflightOutcome,
  consultationPreflightSchema,
  deriveConsultationOutcomeForManifest,
  type RunManifest,
  runManifestSchema,
} from "../../domain/run.js";

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
  const normalizedProfileSelection = isProfileSelectionRecord(normalized.profileSelection)
    ? {
        validationGaps: Array.isArray(normalized.profileSelection.validationGaps)
          ? (normalized.profileSelection.validationGaps as string[])
          : Array.isArray(normalized.profileSelection.missingCapabilities)
            ? (normalized.profileSelection.missingCapabilities as string[])
            : [],
        oracleIds: Array.isArray(normalized.profileSelection.oracleIds)
          ? (normalized.profileSelection.oracleIds as string[])
          : [],
      }
    : undefined;
  const normalizedRecommendedWinner = isRecommendedWinnerRecord(normalized.recommendedWinner)
    ? {
        candidateId: normalized.recommendedWinner.candidateId as string,
      }
    : undefined;

  if (normalized.outcome !== undefined) {
    if (!isOutcomeRecord(normalized.outcome)) {
      return normalized;
    }

    const explicitValidationGapCount =
      typeof normalized.outcome.validationGapCount === "number"
        ? normalized.outcome.validationGapCount
        : undefined;
    const explicitMissingCapabilityCount =
      typeof normalized.outcome.missingCapabilityCount === "number"
        ? normalized.outcome.missingCapabilityCount
        : undefined;
    const validationGapCount =
      explicitValidationGapCount !== undefined
        ? explicitValidationGapCount
        : explicitMissingCapabilityCount !== undefined
          ? explicitMissingCapabilityCount
          : (normalizedProfileSelection?.validationGaps.length ??
            inferLegacyValidationGapCount(normalized.outcome));

    return {
      ...normalized,
      outcome: {
        ...normalized.outcome,
        ...(explicitValidationGapCount === undefined && validationGapCount !== undefined
          ? {
              validationGapCount,
            }
          : {}),
        ...(explicitMissingCapabilityCount === undefined && validationGapCount !== undefined
          ? {
              missingCapabilityCount: validationGapCount,
            }
          : {}),
        ...(typeof normalized.outcome.recommendedCandidateId !== "string" &&
        normalized.outcome.type === "recommended-survivor" &&
        normalizedRecommendedWinner
          ? {
              recommendedCandidateId: normalizedRecommendedWinner.candidateId,
            }
          : {}),
      },
    };
  }

  if (typeof normalized.status !== "string") {
    return normalized;
  }

  const parsedPreflight = consultationPreflightSchema.safeParse(normalized.preflight);
  if (parsedPreflight.success && parsedPreflight.data.decision !== "proceed") {
    return {
      ...normalized,
      outcome: buildBlockedPreflightOutcome(parsedPreflight.data),
    };
  }

  return {
    ...normalized,
    outcome: deriveConsultationOutcomeForManifest({
      status: normalized.status as RunManifest["status"],
      candidates: normalized.candidates as RunManifest["candidates"],
      rounds: Array.isArray(normalized.rounds) ? (normalized.rounds as RunManifest["rounds"]) : [],
      ...(normalizedProfileSelection
        ? {
            profileSelection: normalizedProfileSelection,
          }
        : {}),
      ...(normalizedRecommendedWinner ? { recommendedWinner: normalizedRecommendedWinner } : {}),
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileSelectionRecord(value: unknown): value is {
  missingCapabilities?: string[];
  validationGaps?: string[];
  oracleIds?: string[];
} {
  return isRecord(value);
}

function isOutcomeRecord(value: unknown): value is {
  type?: string;
  validationPosture?: string;
  validationGapCount?: number;
  missingCapabilityCount?: number;
  recommendedCandidateId?: string;
} {
  return isRecord(value);
}

function inferLegacyValidationGapCount(outcome: {
  type?: string;
  validationPosture?: string;
}): number | undefined {
  if (outcome.type === "external-research-required") {
    return 0;
  }

  if (outcome.validationPosture === "validation-gaps") {
    return undefined;
  }

  if (outcome.validationPosture === "sufficient" || outcome.validationPosture === "unknown") {
    return 0;
  }

  return undefined;
}

function isRecommendedWinnerRecord(value: unknown): value is { candidateId: string } {
  return isRecord(value) && typeof value.candidateId === "string";
}
