import type { AgentRunResult } from "../adapters/types.js";
import type { RoundId } from "../domain/config.js";
import {
  type OracleVerdict,
  oracleVerdictSchema,
  type Witness,
  witnessSchema,
} from "../domain/oracle.js";
import type { CandidateManifest } from "../domain/run.js";

interface EvaluateCandidateRoundOptions {
  candidate: CandidateManifest;
  result: AgentRunResult;
  roundId: RoundId;
}

interface EvaluateCandidateRoundResult {
  survives: boolean;
  verdicts: OracleVerdict[];
  witnesses: Witness[];
}

interface OracleDefinition {
  evaluate(options: EvaluateCandidateRoundOptions): {
    verdict: OracleVerdict;
    witnesses: Witness[];
  };
  oracleId: string;
  roundId: RoundId;
}

const registeredOracles: OracleDefinition[] = [
  {
    oracleId: "agent-exit",
    roundId: "fast",
    evaluate(options) {
      const exitWitness = witnessSchema.parse({
        id: `${options.candidate.id}-agent-exit`,
        kind: "log",
        title: "Agent process exit",
        detail: `Adapter status=${options.result.status}, exitCode=${options.result.exitCode}.`,
        scope: [options.candidate.id, options.candidate.strategyId],
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "agent-exit",
          roundId: "fast",
          status: options.result.status === "completed" ? "pass" : "fail",
          severity: options.result.status === "completed" ? "info" : "error",
          summary:
            options.result.status === "completed"
              ? "Agent completed without a process failure."
              : "Agent execution did not complete successfully.",
          invariant: "The host adapter must finish candidate execution successfully.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          witnesses: [exitWitness],
        }),
        witnesses: [exitWitness],
      };
    },
  },
  {
    oracleId: "artifact-capture",
    roundId: "fast",
    evaluate(options) {
      const hasMaterializedOutput = options.result.artifacts.some(
        (artifact) => artifact.kind !== "prompt" && artifact.kind !== "stderr",
      );
      const artifactWitness = witnessSchema.parse({
        id: `${options.candidate.id}-artifact-capture`,
        kind: "file",
        title: "Captured execution artifacts",
        detail: `Persisted ${options.result.artifacts.length} agent artifact(s).`,
        scope: [options.candidate.id],
        excerpt: options.result.artifacts.map((artifact) => artifact.kind).join(", "),
      });

      return {
        verdict: oracleVerdictSchema.parse({
          oracleId: "artifact-capture",
          roundId: "fast",
          status: hasMaterializedOutput ? "pass" : "fail",
          severity: hasMaterializedOutput ? "info" : "warning",
          summary: hasMaterializedOutput
            ? "Execution produced persisted artifacts for later review."
            : "Execution did not leave enough artifacts for review.",
          invariant: "Each candidate run must persist inspectable execution artifacts.",
          confidence: "high",
          affectedScope: [options.candidate.id],
          repairHint: hasMaterializedOutput
            ? undefined
            : "Capture stdout, transcripts, reports, or patches from the host runtime.",
          witnesses: [artifactWitness],
        }),
        witnesses: [artifactWitness],
      };
    },
  },
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
];

export function evaluateCandidateRound(
  options: EvaluateCandidateRoundOptions,
): EvaluateCandidateRoundResult {
  const selectedOracles = registeredOracles.filter((oracle) => oracle.roundId === options.roundId);
  const verdicts: OracleVerdict[] = [];
  const witnesses: Witness[] = [];

  for (const oracle of selectedOracles) {
    const evaluation = oracle.evaluate(options);
    verdicts.push(evaluation.verdict);
    witnesses.push(...evaluation.witnesses);
  }

  return {
    survives: verdicts.every(
      (verdict) =>
        verdict.status === "pass" || verdict.status === "skip" || verdict.status === "repairable",
    ),
    verdicts,
    witnesses,
  };
}
