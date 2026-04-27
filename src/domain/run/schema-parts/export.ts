import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";
import {
  exportMaterializationModeSchema,
  exportModeSchema,
  optionalNonEmptyStringSchema,
  reportBundleSchema,
} from "./shared.js";

export const exportPlanSchema = z
  .object({
    runId: artifactPathSegmentSchema,
    winnerId: artifactPathSegmentSchema,
    branchName: optionalNonEmptyStringSchema,
    materializationLabel: optionalNonEmptyStringSchema,
    mode: exportModeSchema,
    materializationMode: exportMaterializationModeSchema,
    workspaceDir: z.string().min(1),
    patchPath: z.string().min(1).optional(),
    appliedPathCount: z.number().int().min(0).optional(),
    removedPathCount: z.number().int().min(0).optional(),
    withReport: z.boolean(),
    reportBundle: reportBundleSchema.optional(),
    safetyOverride: z.literal("operator-allow-unsafe").optional(),
    createdAt: z.string().min(1),
  })
  .superRefine((plan, context) => {
    if (plan.mode === "git-branch" && !plan.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch exports must include branchName.",
        path: ["branchName"],
      });
    }

    if (plan.mode === "git-branch" && plan.materializationMode !== "branch") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'git-branch exports must use materializationMode "branch".',
      });
    }

    if (plan.mode === "git-apply" && plan.branchName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchName"],
        message: "Git working-tree exports must not include branchName.",
      });
    }

    if (plan.mode === "git-apply" && plan.materializationMode !== "working-tree") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'git-apply exports must use materializationMode "working-tree".',
      });
    }

    if (plan.mode === "workspace-sync" && plan.materializationMode !== "workspace-sync") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'workspace-sync exports must use materializationMode "workspace-sync".',
      });
    }

    if ((plan.mode === "git-branch" || plan.mode === "git-apply") && !plan.patchPath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["patchPath"],
        message: "Git exports must include patchPath.",
      });
    }
  });

export const latestRunStateSchema = z.object({
  runId: artifactPathSegmentSchema,
  updatedAt: z.string().min(1),
});
