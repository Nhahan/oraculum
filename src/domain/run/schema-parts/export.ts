import { z } from "zod";

import { artifactPathSegmentSchema } from "../../artifact-id.js";
import {
  deriveExportMaterializationMode,
  deriveExportModeFromMaterializationMode,
  exportMaterializationModeSchema,
  exportModeSchema,
  optionalNonEmptyStringSchema,
  reportBundleSchema,
} from "./shared.js";

export const exportPlanSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const payload = value as Record<string, unknown>;
    const mode = typeof payload.mode === "string" ? payload.mode : undefined;
    const materializationMode =
      typeof payload.materializationMode === "string" ? payload.materializationMode : undefined;
    const patchPath = typeof payload.patchPath === "string" ? payload.patchPath : undefined;
    const materializationPatchPath =
      typeof payload.materializationPatchPath === "string"
        ? payload.materializationPatchPath
        : undefined;

    return {
      ...payload,
      ...(mode
        ? { mode }
        : materializationMode
          ? {
              mode: deriveExportModeFromMaterializationMode(
                materializationMode as z.infer<typeof exportMaterializationModeSchema>,
              ),
            }
          : {}),
      ...(materializationMode
        ? { materializationMode }
        : mode
          ? {
              materializationMode: deriveExportMaterializationMode(
                mode as z.infer<typeof exportModeSchema>,
              ),
            }
          : {}),
      ...(patchPath
        ? { patchPath }
        : materializationPatchPath
          ? { patchPath: materializationPatchPath }
          : {}),
      ...(materializationPatchPath
        ? { materializationPatchPath }
        : patchPath
          ? { materializationPatchPath: patchPath }
          : {}),
    };
  },
  z
    .object({
      runId: artifactPathSegmentSchema,
      winnerId: artifactPathSegmentSchema,
      branchName: optionalNonEmptyStringSchema,
      materializationLabel: optionalNonEmptyStringSchema,
      mode: exportModeSchema,
      materializationMode: exportMaterializationModeSchema,
      workspaceDir: z.string().min(1),
      patchPath: z.string().min(1).optional(),
      materializationPatchPath: z.string().min(1).optional(),
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

      if (plan.materializationMode !== deriveExportMaterializationMode(plan.mode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["materializationMode"],
          message:
            "materializationMode must match mode when both legacy and canonical export fields are present.",
        });
      }

      if (
        plan.patchPath !== undefined &&
        plan.materializationPatchPath !== undefined &&
        plan.patchPath !== plan.materializationPatchPath
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["materializationPatchPath"],
          message:
            "materializationPatchPath must match patchPath when both legacy and canonical export fields are present.",
        });
      }
    }),
);

export const latestRunStateSchema = z.object({
  runId: artifactPathSegmentSchema,
  updatedAt: z.string().min(1),
});
