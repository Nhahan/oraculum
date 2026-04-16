import { deriveResearchConflictHandling } from "../../task.js";

export function normalizeVerdictReviewInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const payload = { ...(value as Record<string, unknown>) };
  if (typeof payload.validationProfileId !== "string" && typeof payload.profileId === "string") {
    payload.validationProfileId = payload.profileId;
  }
  if (typeof payload.profileId !== "string" && typeof payload.validationProfileId === "string") {
    payload.profileId = payload.validationProfileId;
  }
  if (!Array.isArray(payload.validationGaps) && Array.isArray(payload.profileMissingCapabilities)) {
    payload.validationGaps = payload.profileMissingCapabilities;
  }
  if (!Array.isArray(payload.profileMissingCapabilities) && Array.isArray(payload.validationGaps)) {
    payload.profileMissingCapabilities = payload.validationGaps;
  }

  const hasPersistedResearchContext =
    (typeof payload.researchSignalCount === "number" && payload.researchSignalCount > 0) ||
    typeof payload.researchSignalFingerprint === "string" ||
    typeof payload.researchConfidence === "string" ||
    typeof payload.researchRerunInputPath === "string" ||
    typeof payload.researchSummary === "string" ||
    (typeof payload.researchSourceCount === "number" && payload.researchSourceCount > 0) ||
    (typeof payload.researchClaimCount === "number" && payload.researchClaimCount > 0) ||
    (typeof payload.researchVersionNoteCount === "number" &&
      payload.researchVersionNoteCount > 0) ||
    (typeof payload.researchConflictCount === "number" && payload.researchConflictCount > 0) ||
    payload.researchConflictsPresent === true ||
    typeof payload.researchConflictHandling === "string";

  if (typeof payload.researchConflictHandling !== "string" && hasPersistedResearchContext) {
    payload.researchConflictHandling = deriveResearchConflictHandling(
      payload.researchConflictsPresent === true ? ["persisted-conflict"] : [],
    );
  }
  if (typeof payload.researchBasisStatus !== "string") {
    payload.researchBasisStatus =
      payload.researchBasisDrift === true
        ? "stale"
        : hasPersistedResearchContext
          ? "current"
          : "unknown";
  }

  return payload;
}
