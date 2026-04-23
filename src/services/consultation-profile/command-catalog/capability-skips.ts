import type { ProfileSkippedCommandCandidate } from "../../../domain/profile.js";

export function appendSkippedCommandCandidate(
  skippedCommandCandidates: ProfileSkippedCommandCandidate[],
  candidate: ProfileSkippedCommandCandidate,
): void {
  const key = [
    candidate.id,
    candidate.reason,
    candidate.capability,
    candidate.provenance?.signal ?? "",
    candidate.provenance?.path ?? "",
  ].join("\0");
  const alreadyRecorded = skippedCommandCandidates.some(
    (existing) =>
      [
        existing.id,
        existing.reason,
        existing.capability,
        existing.provenance?.signal ?? "",
        existing.provenance?.path ?? "",
      ].join("\0") === key,
  );
  if (!alreadyRecorded) {
    skippedCommandCandidates.push(candidate);
  }
}
