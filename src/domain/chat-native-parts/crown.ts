import { z } from "zod";

import { artifactPathSegmentSchema } from "../artifact-id.js";
import {
  exportMaterializationModeSchema,
  exportModeSchema,
  exportPlanSchema,
  optionalNonEmptyStringSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "../run.js";

export const crownActionRequestInputSchema = z
  .object({
    cwd: z.string().min(1),
    materializationName: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
    consultationId: artifactPathSegmentSchema.optional(),
    candidateId: artifactPathSegmentSchema.optional(),
    withReport: z.boolean().default(false),
    allowUnsafe: z.boolean().optional(),
  })
  .strict();
export const crownActionRequestSchema = crownActionRequestInputSchema;

export const crownMaterializationCheckSchema = z.object({
  id: z.enum(["current-branch", "git-patch-artifact", "changed-paths", "workspace-sync-summary"]),
  status: z.literal("passed"),
  summary: z.string().min(1),
});

export const crownMaterializationSchema = z
  .object({
    materialized: z.literal(true),
    verified: z.literal(true),
    mode: exportModeSchema,
    materializationMode: exportMaterializationModeSchema,
    branchName: optionalNonEmptyStringSchema,
    materializationName: optionalNonEmptyStringSchema,
    materializationLabel: optionalNonEmptyStringSchema,
    currentBranch: z.string().min(1).optional(),
    changedPaths: z.array(z.string().min(1)).default([]),
    changedPathCount: z.number().int().min(0),
    checks: z.array(crownMaterializationCheckSchema).min(1),
  })
  .superRefine((materialization, context) => {
    if (materialization.mode === "git-branch" && !materialization.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch materializations must include branchName.",
        path: ["branchName"],
      });
    }

    if (materialization.mode === "git-branch" && materialization.materializationMode !== "branch") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'git-branch materializations must use materializationMode "branch".',
      });
    }

    if (materialization.mode === "git-apply" && materialization.branchName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branchName"],
        message: "Git working-tree materializations must not include branchName.",
      });
    }

    if (
      materialization.mode === "git-apply" &&
      materialization.materializationMode !== "working-tree"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'git-apply materializations must use materializationMode "working-tree".',
      });
    }

    if (
      materialization.mode === "workspace-sync" &&
      materialization.materializationMode !== "workspace-sync"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message: 'workspace-sync materializations must use materializationMode "workspace-sync".',
      });
    }

    if (
      materialization.mode === "git-branch" &&
      materialization.materializationName &&
      materialization.branchName &&
      materialization.materializationName !== materialization.branchName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message: "materializationName must match branchName for git-branch crown materializations.",
      });
    }

    if (
      (materialization.mode === "git-apply" || materialization.mode === "workspace-sync") &&
      materialization.materializationName &&
      materialization.materializationLabel &&
      materialization.materializationName !== materialization.materializationLabel
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message:
          "materializationName must match materializationLabel for labeled crown materializations.",
      });
    }
  });

export const crownActionResponseSchema = z.object({
  mode: z.literal("crown"),
  plan: exportPlanSchema,
  recordPath: z.string().min(1),
  materialization: crownMaterializationSchema,
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
});

export type CrownActionRequest = z.infer<typeof crownActionRequestSchema>;
export type CrownMaterialization = z.infer<typeof crownMaterializationSchema>;
export type CrownMaterializationCheck = z.infer<typeof crownMaterializationCheckSchema>;
export type CrownActionResponse = z.infer<typeof crownActionResponseSchema>;
