import { isAbsolute, win32 } from "node:path";

import { z } from "zod";

export const projectRelativePathSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    if (
      value.includes("\0") ||
      isAbsolute(value) ||
      win32.isAbsolute(value) ||
      value.split(/[\\/]+/u).includes("..")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Project artifact paths must be safe relative paths inside the project root.",
      });
    }
  });
