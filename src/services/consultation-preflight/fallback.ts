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
  const clarificationQuestion =
    !reusedResearchBrief && options.runtimeAttempted
      ? inferFallbackClarificationQuestion(options.taskPacket)
      : undefined;
  const researchQuestion =
    !reusedResearchBrief && options.runtimeAttempted
      ? inferFallbackResearchQuestion(options.taskPacket)
      : undefined;
  const defaultFlow = reusedResearchBrief
    ? "Proceed conservatively using the persisted research brief plus repository evidence."
    : "Proceed conservatively with the default consultation flow.";
  const runtimeSummary = options.runtimeAttempted
    ? options.llmFailure
      ? `Runtime preflight failed: ${options.llmFailure}.`
      : "Runtime preflight did not return a structured recommendation."
    : "Runtime preflight was skipped.";

  if (researchQuestion) {
    return consultationPreflightSchema.parse({
      decision: "external-research-required",
      confidence: "low",
      summary: `${runtimeSummary} Official current-version documentation is still required before safe execution.`,
      researchPosture: consultationResearchPostureSchema.enum["external-research-required"],
      researchQuestion,
    });
  }

  if (clarificationQuestion) {
    return consultationPreflightSchema.parse({
      decision: "needs-clarification",
      confidence: "low",
      summary: `${runtimeSummary} The task still lacks a concrete target artifact or result contract for safe execution.`,
      researchPosture: consultationResearchPostureSchema.enum["repo-only"],
      clarificationQuestion,
    });
  }

  return consultationPreflightSchema.parse({
    decision: "proceed",
    confidence: "low",
    summary: `${runtimeSummary} ${defaultFlow}`,
    researchPosture: reusedResearchBrief
      ? consultationResearchPostureSchema.enum["repo-plus-external-docs"]
      : consultationResearchPostureSchema.enum["repo-only"],
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

function inferFallbackClarificationQuestion(
  taskPacket: MaterializedTaskPacket,
): string | undefined {
  if (
    taskPacket.artifactKind ||
    taskPacket.targetArtifactPath ||
    taskPacket.acceptanceCriteria.length > 0 ||
    taskPacket.contextFiles.length > 0 ||
    taskPacket.oracleHints.length > 0 ||
    taskPacket.researchContext
  ) {
    return undefined;
  }

  const text = buildFallbackTaskText(taskPacket);
  const hasConcretePathCue =
    /(?:^|\s|`)(?:\.{0,2}\/)?[\w@-]+(?:\/[\w@.-]+)+\.[\w-]+(?:`|$|\s)/iu.test(text);
  const hasConcreteCodeCue = /`[^`]+`|\b[a-z_][\w]*\(\)|\breturns?\b\s+["'`][^"'`]+["'`]/iu.test(
    text,
  );
  const hasVagueQualityCue =
    /\bbetter\b|\bmore complete\b|\bclearer\b|\bobviously better\b|\bright artifact\b|\bif one should change\b/iu.test(
      text,
    );

  if (!hasVagueQualityCue || hasConcretePathCue || hasConcreteCodeCue) {
    return undefined;
  }

  return "Which file or artifact should Oraculum update, and what concrete result should it produce?";
}

function inferFallbackResearchQuestion(taskPacket: MaterializedTaskPacket): string | undefined {
  const text = buildFallbackTaskText(taskPacket);
  const mentionsOfficial = /\bofficial\b/iu.test(text);
  const mentionsCurrentVersion = /\blatest\b|\bcurrent\b|\bversion(?:ed|-specific)?\b/iu.test(text);
  const mentionsDocsOrGuidance =
    /\bdocs?\b|\bdocumentation\b|\bguidance\b|\bapi\b|\bschema generation\b|\bstructured tool output\b/iu.test(
      text,
    );

  if (!mentionsOfficial || !mentionsCurrentVersion || !mentionsDocsOrGuidance) {
    return undefined;
  }

  return "What do the official current-version docs say about the requested behavior or guidance?";
}

function buildFallbackTaskText(taskPacket: MaterializedTaskPacket): string {
  return [
    taskPacket.title,
    taskPacket.intent,
    ...taskPacket.nonGoals,
    ...taskPacket.acceptanceCriteria,
    ...taskPacket.risks,
    ...taskPacket.oracleHints,
    ...taskPacket.contextFiles,
  ].join("\n");
}
