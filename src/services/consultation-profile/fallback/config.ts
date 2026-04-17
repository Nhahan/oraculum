import { defaultProjectConfig } from "../../../domain/config.js";
import type { ConsultationProfileId } from "../../../domain/profile.js";

import type {
  FallbackAnchoredProfileId,
  MissingCapabilityRule,
  ProfileCommandSlot,
} from "../shared.js";

export const FALLBACK_DEFAULT_CANDIDATE_COUNT = defaultProjectConfig.defaultCandidates;
export const FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT = Math.min(
  3,
  FALLBACK_DEFAULT_CANDIDATE_COUNT,
);

export const VALIDATION_POSTURE_FALLBACK_ANCHORS: Record<
  FallbackAnchoredProfileId,
  ProfileCommandSlot[]
> = {
  frontend: [{ roundId: "deep", capability: "e2e-or-visual" }],
  migration: [
    { roundId: "fast", capability: "schema-validation" },
    { roundId: "impact", capability: "migration-dry-run" },
    { roundId: "deep", capability: "rollback-simulation" },
    { roundId: "deep", capability: "migration-drift" },
  ],
};

export const FALLBACK_BASELINE_COMMAND_SLOTS: ProfileCommandSlot[] = [
  { roundId: "fast", capability: "lint" },
  { roundId: "fast", capability: "typecheck" },
  { roundId: "impact", capability: "changed-area-test" },
  { roundId: "impact", capability: "unit-test" },
  { roundId: "impact", capability: "build" },
  { roundId: "deep", capability: "full-suite-test" },
];

export const VALIDATION_POSTURE_MISSING_CAPABILITY_RULES: Record<
  Exclude<ConsultationProfileId, "generic">,
  MissingCapabilityRule[]
> = {
  library: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "deep", capability: "full-suite-test" }],
      whenDetectedButNotSelected: "No full-suite deep test command was selected.",
      whenNotDetected: "No full-suite deep test command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [
        { roundId: "deep", capability: "package-export-smoke" },
        { roundId: "impact", capability: "package-export-smoke" },
      ],
      whenDetectedButNotSelected: "No package packaging smoke check was selected.",
      whenNotDetected: "No package packaging smoke check was detected.",
    },
  ],
  frontend: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "impact", capability: "build" }],
      whenDetectedButNotSelected: "No build validation command was selected.",
      whenNotDetected: "No build validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "deep", capability: "e2e-or-visual" }],
      whenDetectedButNotSelected: "No e2e or visual deep check was selected.",
      whenNotDetected: "No e2e or visual deep check was detected.",
    },
  ],
  migration: [
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "fast", capability: "schema-validation" }],
      whenDetectedButNotSelected: "No schema validation command was selected.",
      whenNotDetected: "No schema validation command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [{ roundId: "impact", capability: "migration-dry-run" }],
      whenDetectedButNotSelected: "No migration planning or dry-run command was selected.",
      whenNotDetected: "No migration planning or dry-run command was detected.",
    },
    {
      runtimeEvidencePredicate: ({ hasCatalogEvidence, hasSkippedEvidence }) =>
        hasCatalogEvidence || hasSkippedEvidence,
      slots: [
        { roundId: "deep", capability: "rollback-simulation" },
        { roundId: "deep", capability: "migration-drift" },
      ],
      whenDetectedButNotSelected:
        "No rollback simulation or migration drift deep check was selected.",
      whenNotDetected: "No rollback simulation or migration drift deep check was detected.",
    },
  ],
};
