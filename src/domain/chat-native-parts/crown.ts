import { z } from "zod";

import {
  exportMaterializationModeSchema,
  exportModeSchema,
  exportPlanSchema,
  getExportMaterializationMode,
  optionalNonEmptyStringSchema,
  runManifestSchema,
  savedConsultationStatusSchema,
} from "../run.js";

export const crownToolRequestInputSchema = z.object({
  cwd: z.string().min(1),
  branchName: z.string().min(1).optional(),
  materializationName: z.string().min(1).optional(),
  materializationLabel: z.string().min(1).optional(),
  consultationId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  withReport: z.boolean().default(false),
});

const crownToolRequestValidatedSchema = crownToolRequestInputSchema.superRefine(
  (request, context) => {
    if (
      request.branchName &&
      request.materializationName &&
      request.branchName !== request.materializationName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message:
          "materializationName must match branchName when both legacy and canonical crown request fields are present.",
      });
    }
  },
);

export const crownToolRequestSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const payload = value as Record<string, unknown>;
  const branchName = typeof payload.branchName === "string" ? payload.branchName : undefined;
  const materializationName =
    typeof payload.materializationName === "string" ? payload.materializationName : undefined;

  return {
    ...payload,
    ...(branchName
      ? { branchName }
      : materializationName
        ? { branchName: materializationName }
        : {}),
    ...(materializationName
      ? { materializationName }
      : branchName
        ? { materializationName: branchName }
        : {}),
  };
}, crownToolRequestValidatedSchema);

export const crownMaterializationCheckSchema = z.object({
  id: z.enum(["current-branch", "git-patch-artifact", "changed-paths", "workspace-sync-summary"]),
  status: z.literal("passed"),
  summary: z.string().min(1),
});

export const crownMaterializationSchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }

      const payload = value as Record<string, unknown>;
      const mode = typeof payload.mode === "string" ? payload.mode : undefined;
      const materializationMode =
        typeof payload.materializationMode === "string" ? payload.materializationMode : undefined;
      const branchName = typeof payload.branchName === "string" ? payload.branchName : undefined;
      const materializationLabel =
        typeof payload.materializationLabel === "string" ? payload.materializationLabel : undefined;
      const materializationName =
        typeof payload.materializationName === "string" ? payload.materializationName : undefined;
      const resolvedMode =
        mode ??
        (materializationMode === "branch"
          ? "git-branch"
          : materializationMode === "workspace-sync"
            ? "workspace-sync"
            : undefined);
      const resolvedMaterializationMode =
        materializationMode ??
        (mode === "git-branch"
          ? "branch"
          : mode === "workspace-sync"
            ? "workspace-sync"
            : undefined);

      return {
        ...payload,
        ...(resolvedMode ? { mode: resolvedMode } : {}),
        ...(resolvedMaterializationMode
          ? { materializationMode: resolvedMaterializationMode }
          : {}),
        ...(branchName
          ? { branchName }
          : materializationName && resolvedMaterializationMode === "branch"
            ? { branchName: materializationName }
            : {}),
        ...(materializationLabel
          ? { materializationLabel }
          : materializationName && resolvedMaterializationMode === "workspace-sync"
            ? { materializationLabel: materializationName }
            : {}),
        ...(materializationName
          ? { materializationName }
          : branchName
            ? { materializationName: branchName }
            : materializationLabel
              ? { materializationName: materializationLabel }
              : {}),
      };
    },
    z.object({
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
    }),
  )
  .superRefine((materialization, context) => {
    if (materialization.mode === "git-branch" && !materialization.branchName) {
      context.addIssue({
        code: "custom",
        message: "Git branch materializations must include branchName.",
        path: ["branchName"],
      });
    }

    if (materialization.materializationMode !== getExportMaterializationMode(materialization)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationMode"],
        message:
          "materializationMode must match mode when both legacy and canonical crown materialization fields are present.",
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
      materialization.mode === "workspace-sync" &&
      materialization.materializationName &&
      materialization.materializationLabel &&
      materialization.materializationName !== materialization.materializationLabel
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materializationName"],
        message:
          "materializationName must match materializationLabel for workspace-sync crown materializations.",
      });
    }
  });

export const crownToolResponseSchema = z.object({
  mode: z.literal("crown"),
  plan: exportPlanSchema,
  recordPath: z.string().min(1),
  materialization: crownMaterializationSchema,
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
});

export type CrownToolRequest = z.infer<typeof crownToolRequestSchema>;
export type CrownMaterialization = z.infer<typeof crownMaterializationSchema>;
export type CrownMaterializationCheck = z.infer<typeof crownMaterializationCheckSchema>;
export type CrownToolResponse = z.infer<typeof crownToolResponseSchema>;
