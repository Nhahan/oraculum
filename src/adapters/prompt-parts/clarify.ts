import type { AgentClarifyFollowUpRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
} from "./shared.js";

export function buildClarifyFollowUpPrompt(request: AgentClarifyFollowUpRequest): string {
  const sections: string[] = [
    "You are deepening a repeated blocked Oraculum preflight on the same scope.",
    "Do not solve the task and do not reconsider the blocked decision.",
    "Keep the current blocked decision exactly as-is and produce one bounded follow-up artifact for the operator.",
    'Return JSON only in this shape: {"summary":"short rationale","keyQuestion":"one short question","missingResultContract":"one concrete missing result-contract statement","missingJudgingBasis":"one concrete missing judging-basis statement"}',
    "",
    `Current blocked decision: ${request.preflight.decision}`,
    `Current confidence: ${request.preflight.confidence}`,
    `Current research posture: ${request.preflight.researchPosture}`,
    `Current summary: ${request.preflight.summary}`,
    `Repeated scope: ${request.pressureContext.scopeKeyType} (${request.pressureContext.scopeKey})`,
    `Repeated case count: ${request.pressureContext.repeatedCaseCount}`,
    `Repeated pressure kinds: ${request.pressureContext.repeatedKinds.join(", ")}`,
    "",
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    `Task Source: ${request.taskPacket.source.kind} (${request.taskPacket.source.path})`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

  appendResultIntentContext(sections, request.taskPacket);
  appendArtifactIntentContext(sections, request.taskPacket);
  appendTaskSourceContext(sections, request.taskPacket);
  appendStructuredResearchContext(sections, request.taskPacket);

  if (request.preflight.clarificationQuestion) {
    sections.push("", `Current clarification question: ${request.preflight.clarificationQuestion}`);
  }
  if (request.preflight.researchQuestion) {
    sections.push("", `Current research question: ${request.preflight.researchQuestion}`);
  }
  if (request.pressureContext.priorQuestions.length > 0) {
    sections.push(
      "",
      "Prior repeated blocker questions:",
      ...request.pressureContext.priorQuestions.map((question) => `- ${question}`),
    );
  }
  if (request.pressureContext.recurringReasons.length > 0) {
    sections.push(
      "",
      "Recurring pressure reasons:",
      ...request.pressureContext.recurringReasons.map((reason) => `- ${reason}`),
    );
  }

  if (request.taskPacket.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "Acceptance criteria:",
      ...request.taskPacket.acceptanceCriteria.map((item) => `- ${item}`),
    );
  }

  if (request.taskPacket.risks.length > 0) {
    sections.push("", "Known risks:", ...request.taskPacket.risks.map((item) => `- ${item}`));
  }

  sections.push(
    "",
    "Detected repository signals:",
    `- package manager: ${request.signals.packageManager}`,
    `- scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `- notable files: ${request.signals.files.join(", ") || "none"}`,
    `- workspace roots: ${request.signals.workspaceRoots.join(", ") || "none"}`,
  );

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push(
    "",
    "Rules:",
    "- Keep one bounded keyQuestion only.",
    "- missingResultContract must state the exact missing result contract that still blocks safe candidate generation.",
    "- missingJudgingBasis must state the exact missing validation or comparison basis that would still make winner selection unsafe later.",
    "- Do not invent repository facts, external citations, or target artifacts.",
    "- Keep every field concise, concrete, and replayable.",
    "- Return JSON only.",
  );

  return `${sections.join("\n")}\n`;
}
