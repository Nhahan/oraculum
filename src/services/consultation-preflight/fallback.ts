import {
  type ConsultationPreflight,
  consultationPreflightSchema,
  consultationResearchPostureSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

import type { ClarifyBlockedPreflight } from "./types.js";

export function buildFallbackPreflight(options: {
  runtimeAttempted: boolean;
  taskPacket: MaterializedTaskPacket;
  llmFailure?: string;
}): ConsultationPreflight {
  const reusedResearchBrief = options.taskPacket.source.kind === "research-brief";
  const runtimeSummary = options.runtimeAttempted
    ? options.llmFailure
      ? `Runtime preflight failed: ${options.llmFailure}.`
      : "Runtime preflight did not return a structured recommendation."
    : "Runtime preflight was skipped.";

  return consultationPreflightSchema.parse({
    decision: "needs-clarification",
    confidence: "low",
    summary: `${runtimeSummary} Candidate generation is blocked until the operator confirms the task contract.`,
    researchPosture: reusedResearchBrief
      ? consultationResearchPostureSchema.enum["repo-plus-external-docs"]
      : consultationResearchPostureSchema.enum["repo-only"],
    clarificationQuestion:
      "What exact outcome should Oraculum produce so the tournament can judge success?",
  });
}

export function isClarifyBlockedPreflight(
  preflight: ConsultationPreflight,
): preflight is ClarifyBlockedPreflight {
  return (
    preflight.decision === "needs-clarification" ||
    preflight.decision === "external-research-required"
  );
}
