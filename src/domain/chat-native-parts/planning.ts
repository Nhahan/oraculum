import { z } from "zod";

import { runManifestSchema, savedConsultationStatusSchema } from "../run.js";
import {
  artifactDiagnosticSchema,
  consultationArtifactPathsSchema,
  projectInitializationResultSchema,
} from "./common.js";

const planningToolRequestBaseSchema = z
  .object({
    cwd: z.string().min(1),
    taskInput: z.string().min(1),
  })
  .strict();

const planningToolResponseBaseSchema = z.object({
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  artifactDiagnostics: z.array(artifactDiagnosticSchema).optional(),
  initializedProject: projectInitializationResultSchema.optional(),
});

export const consultToolRequestSchema = planningToolRequestBaseSchema;
export const consultToolResponseSchema = planningToolResponseBaseSchema.extend({
  mode: z.literal("consult"),
});

export const planToolRequestSchema = planningToolRequestBaseSchema;
export const planToolResponseSchema = planningToolResponseBaseSchema.extend({
  mode: z.literal("plan"),
});

export const draftToolRequestSchema = planningToolRequestBaseSchema;
export const draftToolResponseSchema = planningToolResponseBaseSchema.extend({
  mode: z.literal("draft"),
});

export type ConsultToolRequest = z.infer<typeof consultToolRequestSchema>;
export type ConsultToolResponse = z.infer<typeof consultToolResponseSchema>;
export type PlanToolRequest = z.infer<typeof planToolRequestSchema>;
export type PlanToolResponse = z.infer<typeof planToolResponseSchema>;
export type DraftToolRequest = z.infer<typeof draftToolRequestSchema>;
export type DraftToolResponse = z.infer<typeof draftToolResponseSchema>;
