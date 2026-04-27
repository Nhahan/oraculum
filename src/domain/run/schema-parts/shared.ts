import { z } from "zod";

export const candidateStatusSchema = z.enum([
  "planned",
  "running",
  "executed",
  "failed",
  "judged",
  "eliminated",
  "promoted",
  "exported",
]);

export const workspaceModeSchema = z.enum(["copy", "git-worktree"]);
export const roundExecutionStatusSchema = z.enum(["pending", "running", "completed"]);
export const consultationOutcomeTypeSchema = z.enum([
  "pending-execution",
  "running",
  "needs-clarification",
  "external-research-required",
  "abstained-before-execution",
  "recommended-survivor",
  "finalists-without-recommendation",
  "no-survivors",
  "completed-with-validation-gaps",
]);
export const consultationValidationPostureSchema = z.enum([
  "sufficient",
  "validation-gaps",
  "unknown",
]);
export const consultationJudgingBasisKindSchema = z.enum([
  "repo-local-oracle",
  "missing-capability",
  "unknown",
]);
export const consultationVerificationLevelSchema = z.enum([
  "none",
  "lightweight",
  "standard",
  "thorough",
]);
export const consultationPreflightDecisionSchema = z.enum([
  "proceed",
  "needs-clarification",
  "external-research-required",
  "abstain",
]);
export const consultationResearchPostureSchema = z.enum([
  "repo-only",
  "repo-plus-external-docs",
  "external-research-required",
  "unknown",
]);
export const clarifyPressureKindSchema = z.enum(["clarify-needed", "external-research-required"]);
export const clarifyScopeKeyTypeSchema = z.enum(["target-artifact", "task-source"]);
export const consultationNextActionSchema = z.enum([
  "reopen-verdict",
  "perform-manual-review",
  "review-preflight-readiness",
  "answer-clarification-and-rerun",
  "gather-external-research-and-rerun",
  "rerun-with-research-brief",
  "refresh-stale-research-and-rerun",
  "revise-task-and-rerun",
  "crown-recommended-result",
  "inspect-comparison-report",
  "review-validation-gaps",
  "add-repo-local-oracle",
  "rerun-with-different-candidate-count",
]);
export const runStatusSchema = z.enum(["planned", "running", "completed"]);
export const reportBundleSchema = z.object({
  rootDir: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
});
export const exportModeSchema = z.enum(["git-apply", "git-branch", "workspace-sync"]);
export const exportMaterializationModeSchema = z.enum(["working-tree", "branch", "workspace-sync"]);
export const optionalNonEmptyStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

export function getExpectedOutcomeFlags(type: z.infer<typeof consultationOutcomeTypeSchema>): {
  terminal: boolean;
  crownable: boolean;
} {
  switch (type) {
    case "pending-execution":
    case "running":
      return { terminal: false, crownable: false };
    case "recommended-survivor":
      return { terminal: true, crownable: true };
    case "needs-clarification":
    case "external-research-required":
    case "abstained-before-execution":
    case "finalists-without-recommendation":
    case "no-survivors":
    case "completed-with-validation-gaps":
      return { terminal: true, crownable: false };
  }
}

export function getBlockedOutcomeType(
  decision: z.infer<typeof consultationPreflightDecisionSchema>,
): z.infer<typeof consultationOutcomeTypeSchema> | undefined {
  switch (decision) {
    case "needs-clarification":
      return "needs-clarification";
    case "external-research-required":
      return "external-research-required";
    case "abstain":
      return "abstained-before-execution";
    case "proceed":
      return undefined;
  }
}
