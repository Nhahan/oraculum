import { oracleVerdictSchema, witnessSchema } from "../../../domain/oracle.js";
import type { OracleDefinition } from "../shared.js";

export const fastBuiltInOracles: OracleDefinition[] = [
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
];
