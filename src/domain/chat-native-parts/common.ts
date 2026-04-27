import { z } from "zod";

export const userInteractionKindSchema = z.enum([
  "augury-question",
  "plan-clarification",
  "consult-clarification",
  "apply-approval",
]);

export const userInteractionOptionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const userInteractionSchema = z
  .object({
    kind: userInteractionKindSchema,
    runId: z.string().min(1),
    header: z.string().min(1),
    question: z.string().min(1),
    expectedAnswerShape: z.string().min(1),
    options: z.array(userInteractionOptionSchema).min(2).max(4).optional(),
    freeTextAllowed: z.literal(true),
    round: z.number().int().min(1).optional(),
    maxRounds: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "augury-question") {
      if (value.round === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["round"],
          message: "round is required for augury-question interactions.",
        });
      }
      if (value.maxRounds === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maxRounds"],
          message: "maxRounds is required for augury-question interactions.",
        });
      }
      return;
    }

    if (value.round !== undefined || value.maxRounds !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["round"],
        message: "round and maxRounds are only allowed for augury-question interactions.",
      });
    }
  });

export const consultationArtifactPathsSchema = z.object({
  consultationRoot: z.string().min(1),
  planningSourceRunId: z.string().min(1).optional(),
  planningSourceConsultationPlanPath: z.string().min(1).optional(),
  configPath: z.string().min(1).optional(),
  consultationPlanPath: z.string().min(1).optional(),
  consultationPlanMarkdownPath: z.string().min(1).optional(),
  consultationPlanReadinessPath: z.string().min(1).optional(),
  consultationPlanReviewPath: z.string().min(1).optional(),
  planningDepthPath: z.string().min(1).optional(),
  planningInterviewPath: z.string().min(1).optional(),
  planningSpecPath: z.string().min(1).optional(),
  planningSpecMarkdownPath: z.string().min(1).optional(),
  planConsensusPath: z.string().min(1).optional(),
  preflightReadinessPath: z.string().min(1).optional(),
  clarifyFollowUpPath: z.string().min(1).optional(),
  researchBriefPath: z.string().min(1).optional(),
  failureAnalysisPath: z.string().min(1).optional(),
  profileSelectionPath: z.string().min(1).optional(),
  comparisonJsonPath: z.string().min(1).optional(),
  comparisonMarkdownPath: z.string().min(1).optional(),
  winnerSelectionPath: z.string().min(1).optional(),
  secondOpinionWinnerSelectionPath: z.string().min(1).optional(),
  crowningRecordPath: z.string().min(1).optional(),
});

export const artifactDiagnosticSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
  status: z.literal("invalid"),
  message: z.string().min(1),
});

export const projectInitializationResultSchema = z.object({
  projectRoot: z.string().min(1),
  configPath: z.string().min(1),
  createdPaths: z.array(z.string().min(1)),
});

export type UserInteraction = z.infer<typeof userInteractionSchema>;
export type UserInteractionKind = z.infer<typeof userInteractionKindSchema>;
export type UserInteractionOption = z.infer<typeof userInteractionOptionSchema>;
