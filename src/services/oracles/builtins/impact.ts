import { oracleVerdictSchema, witnessSchema } from "../../../domain/oracle.js";
import { collectCandidateChangeInsight } from "../../change-insights.js";
import type { OracleDefinition } from "../shared.js";

export const impactBuiltInOracles: OracleDefinition[] = [
  {
    oracleId: "reviewable-output",
    roundId: "impact",
    evaluate(options) {
      const reviewableKinds = new Set(["stdout", "transcript", "report", "patch"]);
      const hasReviewableOutput = options.result.artifacts.some((artifact) =>
        reviewableKinds.has(artifact.kind),
      );
      const outputWitness = witnessSchema.parse({
        id: `${options.candidate.id}-reviewable-output`,
        kind: "file",
        title: "Reviewable output coverage",
        detail: hasReviewableOutput
          ? "Execution left reviewable output for comparison."
          : "Execution did not leave reviewable output for comparison.",
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "reviewable-output",
          roundId: "impact",
          status: hasReviewableOutput ? "pass" : "repairable",
          severity: hasReviewableOutput ? "info" : "warning",
          summary: hasReviewableOutput
            ? "Candidate left artifacts suitable for human or automated comparison."
            : "Candidate lacks reviewable output artifacts beyond prompt/stderr.",
          invariant: "Candidates should leave reviewable output for later comparison.",
          confidence: "medium",
          affectedScope: [options.candidate.id],
          repairHint: hasReviewableOutput
            ? undefined
            : "Persist stdout, transcript, report, or patch artifacts from the runtime.",
          witnesses: [outputWitness],
        }),
        witnesses: [outputWitness],
      };
    },
  },
  {
    oracleId: "materialized-patch",
    roundId: "impact",
    async evaluate(options) {
      const changeInsight = await collectCandidateChangeInsight(options.candidate, {
        rules: options.projectConfig.managedTree,
      });
      const hasMaterializedPatch = changeInsight.changeSummary.changedPathCount > 0;
      const changeWitness = witnessSchema.parse({
        id: `${options.candidate.id}-materialized-patch`,
        kind: "file",
        title: "Materialized workspace changes",
        detail: hasMaterializedPatch
          ? `Captured ${changeInsight.changeSummary.changedPathCount} changed path(s) in the candidate workspace.`
          : "The candidate left no materialized file changes in the workspace.",
        scope: [options.candidate.id],
        ...(changeInsight.changedPaths.length > 0
          ? { excerpt: changeInsight.changedPaths.slice(0, 8).join(", ") }
          : {}),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "materialized-patch",
          roundId: "impact",
          status: hasMaterializedPatch ? "pass" : "repairable",
          severity: hasMaterializedPatch ? "info" : "warning",
          summary: hasMaterializedPatch
            ? "Candidate left materialized file changes in the workspace."
            : "Candidate described a patch but did not leave materialized file changes.",
          invariant: "Each surviving candidate must leave a materialized patch in its workspace.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedPatch
            ? undefined
            : "Edit the necessary files in the workspace and leave the real patch on disk. Do not only describe the change.",
          witnesses: [changeWitness],
        }),
        witnesses: [changeWitness],
      };
    },
  },
];
