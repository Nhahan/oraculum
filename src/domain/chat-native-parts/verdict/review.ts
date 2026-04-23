import type { z } from "zod";
import { verdictReviewObjectSchema } from "./review-shape.js";
import { refineVerdictReview } from "./review-validation.js";

export const verdictReviewSchema = verdictReviewObjectSchema.superRefine(refineVerdictReview);

export type VerdictReview = z.infer<typeof verdictReviewSchema>;
