import { z } from "zod";
import { normalizeVerdictReviewInput } from "./review-normalize.js";
import { verdictReviewObjectSchema } from "./review-shape.js";
import { refineVerdictReview } from "./review-validation.js";

export const verdictReviewSchema = z.preprocess(
  normalizeVerdictReviewInput,
  verdictReviewObjectSchema.superRefine(refineVerdictReview),
);

export type VerdictReview = z.infer<typeof verdictReviewSchema>;
