import { z } from "zod";

export const artifactPathSegmentSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    if (
      value === "." ||
      value === ".." ||
      value.includes("\0") ||
      value.split(/[\\/]+/u).length !== 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Artifact ids must be safe single path segments.",
      });
    }
  });
