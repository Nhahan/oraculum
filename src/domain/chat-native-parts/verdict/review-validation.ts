import type { z } from "zod";
import type { VerdictReviewObject } from "./review-shape.js";

import { refineVerdictReviewAliases } from "./review-validation/aliases.js";
import { refineVerdictReviewClarify } from "./review-validation/clarify.js";
import { refineVerdictReviewOutcome } from "./review-validation/outcome.js";
import { refineVerdictReviewPreflight } from "./review-validation/preflight.js";
import { refineVerdictReviewSecondOpinion } from "./review-validation/second-opinion.js";
import { refineVerdictReviewValidationPosture } from "./review-validation/validation-posture.js";

export function refineVerdictReview(value: VerdictReviewObject, context: z.RefinementCtx): void {
  refineVerdictReviewAliases(value, context);
  refineVerdictReviewOutcome(value, context);
  refineVerdictReviewClarify(value, context);
  refineVerdictReviewSecondOpinion(value, context);
  refineVerdictReviewValidationPosture(value, context);
  refineVerdictReviewPreflight(value, context);
}
