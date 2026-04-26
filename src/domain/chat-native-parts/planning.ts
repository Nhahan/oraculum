import { z } from "zod";

import { runManifestSchema, savedConsultationStatusSchema } from "../run.js";
import {
  artifactDiagnosticSchema,
  consultationArtifactPathsSchema,
  projectInitializationResultSchema,
  userInteractionKindSchema,
  userInteractionSchema,
} from "./common.js";

const planningActionRequestBaseSchema = z
  .object({
    cwd: z.string().min(1),
    taskInput: z.string().min(1),
  })
  .strict();

const userInteractionAnswerActionRequestBaseSchema = z
  .object({
    cwd: z.string().min(1),
    kind: userInteractionKindSchema,
    runId: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict();

const consultActionRequestBaseSchema = z
  .object({
    cwd: z.string().min(1),
    taskInput: z.string().min(1).optional(),
  })
  .strict();

const planningActionResponseBaseSchema = z.object({
  consultation: runManifestSchema,
  status: savedConsultationStatusSchema,
  summary: z.string().min(1),
  artifacts: consultationArtifactPathsSchema,
  artifactDiagnostics: z.array(artifactDiagnosticSchema).optional(),
  initializedProject: projectInitializationResultSchema.optional(),
  userInteraction: userInteractionSchema.optional(),
});

export const consultActionRequestSchema = consultActionRequestBaseSchema;
export const consultActionResponseSchema = planningActionResponseBaseSchema.extend({
  mode: z.literal("consult"),
});

export const planActionRequestSchema = planningActionRequestBaseSchema;
export const planActionResponseSchema = planningActionResponseBaseSchema.extend({
  mode: z.literal("plan"),
});

export const userInteractionAnswerActionRequestSchema =
  userInteractionAnswerActionRequestBaseSchema;
export const userInteractionAnswerActionResponseSchema = z.union([
  consultActionResponseSchema,
  planActionResponseSchema,
]);

export type ConsultActionRequest = z.infer<typeof consultActionRequestSchema>;
export type ConsultActionResponse = z.infer<typeof consultActionResponseSchema>;
export type PlanActionRequest = z.infer<typeof planActionRequestSchema>;
export type PlanActionResponse = z.infer<typeof planActionResponseSchema>;
export type UserInteractionAnswerActionRequest = z.infer<
  typeof userInteractionAnswerActionRequestSchema
>;
export type UserInteractionAnswerActionResponse = z.infer<
  typeof userInteractionAnswerActionResponseSchema
>;
