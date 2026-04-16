import { z } from "zod";

export const consultationArtifactPathsSchema = z.object({
  consultationRoot: z.string().min(1),
  configPath: z.string().min(1).optional(),
  consultationPlanPath: z.string().min(1).optional(),
  consultationPlanMarkdownPath: z.string().min(1).optional(),
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

export const projectInitializationResultSchema = z.object({
  projectRoot: z.string().min(1),
  configPath: z.string().min(1),
  createdPaths: z.array(z.string().min(1)),
});
