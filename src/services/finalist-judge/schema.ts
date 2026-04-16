import { z } from "zod";

import { agentJudgeResultSchema } from "../../adapters/types.js";
import { adapterSchema, secondOpinionJudgeTriggerSchema } from "../../domain/config.js";

export const secondOpinionPrimaryRecommendationSchema = z
  .object({
    source: z.enum(["llm-judge", "fallback-policy"]),
    decision: z.enum(["select", "abstain"]),
    candidateId: z.string().min(1).optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    summary: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.decision === "select" && !value.candidateId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateId"],
        message: "candidateId is required when decision is select.",
      });
    }
  });

export const secondOpinionAgreementSchema = z.enum([
  "agrees-select",
  "agrees-abstain",
  "disagrees-candidate",
  "disagrees-select-vs-abstain",
  "unavailable",
]);

export const secondOpinionWinnerSelectionArtifactSchema = z
  .object({
    runId: z.string().min(1),
    advisoryOnly: z.literal(true),
    adapter: adapterSchema,
    triggerKinds: z.array(secondOpinionJudgeTriggerSchema).min(1),
    triggerReasons: z.array(z.string().min(1)).min(1),
    primaryRecommendation: secondOpinionPrimaryRecommendationSchema,
    result: agentJudgeResultSchema.optional(),
    agreement: secondOpinionAgreementSchema,
    advisorySummary: z.string().min(1),
  })
  .superRefine((value, context) => {
    const recommendation =
      value.result?.status === "completed" ? value.result.recommendation : undefined;

    if (value.triggerKinds.length !== value.triggerReasons.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerReasons"],
        message:
          "triggerReasons must align 1:1 with triggerKinds in the persisted second-opinion artifact.",
      });
    }

    if (value.agreement === "unavailable") {
      if (value.result) {
        if (value.result.runId !== value.runId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "runId"],
            message: "result.runId must match the persisted second-opinion artifact runId.",
          });
        }
        if (value.result.adapter !== value.adapter) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "adapter"],
            message: "result.adapter must match the persisted second-opinion artifact adapter.",
          });
        }
        if (value.result.status === "completed") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "status"],
            message:
              "result.status cannot be completed when second-opinion agreement is unavailable.",
          });
        }
        if ("recommendation" in value.result && value.result.recommendation !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["result", "recommendation"],
            message:
              "result.recommendation must be omitted when second-opinion agreement is unavailable.",
          });
        }
      }
      return;
    }

    if (!value.result) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result"],
        message: "result is required when second-opinion agreement is available.",
      });
      return;
    }

    if (value.result.status !== "completed") {
      if (value.result.runId !== value.runId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["result", "runId"],
          message: "result.runId must match the persisted second-opinion artifact runId.",
        });
      }
      if (value.result.adapter !== value.adapter) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["result", "adapter"],
          message: "result.adapter must match the persisted second-opinion artifact adapter.",
        });
      }
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "status"],
        message: "result.status must be completed when second-opinion agreement is available.",
      });
      return;
    }

    if (!recommendation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "recommendation"],
        message: "result.recommendation is required when second-opinion agreement is available.",
      });
      return;
    }

    if (value.result.runId !== value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "runId"],
        message: "result.runId must match the persisted second-opinion artifact runId.",
      });
    }

    if (value.result.adapter !== value.adapter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "adapter"],
        message: "result.adapter must match the persisted second-opinion artifact adapter.",
      });
    }

    switch (value.agreement) {
      case "agrees-select":
        if (
          value.primaryRecommendation.decision !== "select" ||
          recommendation.decision !== "select" ||
          value.primaryRecommendation.candidateId !== recommendation.candidateId
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message: "agrees-select requires both recommendations to select the same candidate.",
          });
        }
        return;
      case "agrees-abstain":
        if (
          value.primaryRecommendation.decision !== "abstain" ||
          recommendation.decision !== "abstain"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message: "agrees-abstain requires both recommendations to abstain.",
          });
        }
        return;
      case "disagrees-candidate":
        if (
          value.primaryRecommendation.decision !== "select" ||
          recommendation.decision !== "select" ||
          value.primaryRecommendation.candidateId === recommendation.candidateId
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message:
              "disagrees-candidate requires both recommendations to select different candidates.",
          });
        }
        return;
      case "disagrees-select-vs-abstain":
        if (value.primaryRecommendation.decision === recommendation.decision) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["agreement"],
            message:
              "disagrees-select-vs-abstain requires one recommendation to select and the other to abstain.",
          });
        }
        return;
    }
  });

export type SecondOpinionPrimaryRecommendation = z.infer<
  typeof secondOpinionPrimaryRecommendationSchema
>;
export type SecondOpinionAgreement = z.infer<typeof secondOpinionAgreementSchema>;
export type SecondOpinionWinnerSelectionArtifact = z.infer<
  typeof secondOpinionWinnerSelectionArtifactSchema
>;
