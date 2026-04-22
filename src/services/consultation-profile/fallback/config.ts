import { defaultProjectConfig } from "../../../domain/config.js";

import type { ProfileCommandSlot } from "../shared.js";

export const FALLBACK_DEFAULT_CANDIDATE_COUNT = defaultProjectConfig.defaultCandidates;
export const FALLBACK_LOW_CONFIDENCE_CANDIDATE_COUNT = Math.min(
  3,
  FALLBACK_DEFAULT_CANDIDATE_COUNT,
);

export const FALLBACK_BASELINE_COMMAND_SLOTS: ProfileCommandSlot[] = [
  { roundId: "fast", capability: "lint" },
  { roundId: "fast", capability: "typecheck" },
  { roundId: "impact", capability: "changed-area-test" },
  { roundId: "impact", capability: "unit-test" },
  { roundId: "impact", capability: "build" },
  { roundId: "deep", capability: "full-suite-test" },
];
