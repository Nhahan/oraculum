import type { VerdictReview } from "../../src/domain/chat-native.js";
import { verdictReviewSchema } from "../../src/domain/chat-native.js";
import { createVerdictReviewFixture } from "./contract-fixtures.js";

export function createVerdictReviewInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = createVerdictReviewFixture();
  const { artifactAvailability, candidateStateCounts, ...rest } = overrides as Record<
    string,
    unknown
  > & {
    artifactAvailability?: Record<string, unknown>;
    candidateStateCounts?: Record<string, unknown>;
  };

  return {
    ...base,
    ...rest,
    ...(artifactAvailability
      ? {
          artifactAvailability: {
            ...base.artifactAvailability,
            ...artifactAvailability,
          },
        }
      : {}),
    ...(candidateStateCounts
      ? {
          candidateStateCounts: {
            ...base.candidateStateCounts,
            ...candidateStateCounts,
          },
        }
      : {}),
  };
}

export function parseVerdictReview(overrides: Record<string, unknown> = {}): VerdictReview {
  return verdictReviewSchema.parse(createVerdictReviewInput(overrides));
}

export function expectVerdictReviewParseError(
  message: string,
  overrides: Record<string, unknown> = {},
): void {
  expect(() => verdictReviewSchema.parse(createVerdictReviewInput(overrides))).toThrow(message);
}
