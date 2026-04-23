import type { AgentPreflightRequest } from "../types.js";
import {
  appendArtifactIntentContext,
  appendResearchBriefDecisionRules,
  appendResearchSignalDriftContext,
  appendResultIntentContext,
  appendStructuredResearchContext,
  appendTaskSourceContext,
} from "./shared.js";

export function buildPreflightPrompt(request: AgentPreflightRequest): string {
  const sections: string[] = [
    "You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.",
    "Do not solve the task and do not propose implementations. Only decide readiness.",
    'Return JSON only in this shape: {"decision":"proceed","confidence":"medium","summary":"short rationale","researchPosture":"repo-only","clarificationQuestion":null,"researchQuestion":null}',
    "Branch rules: needs-clarification asks one short operator-answerable clarificationQuestion; external-research-required asks one short researchQuestion and sets researchPosture=external-research-required; abstain leaves both questions null and is only for consultations that should not proceed even after clarification.",
    "Do not emit researchBasisDrift; Oraculum records research drift deterministically outside this recommendation.",
    "",
    `Task ID: ${request.taskPacket.id}`,
    `Task Title: ${request.taskPacket.title}`,
    `Task Source: ${request.taskPacket.source.kind} (${request.taskPacket.source.path})`,
    "",
    "Intent:",
    request.taskPacket.intent,
  ];

  if (request.requirePlanningClarification) {
    sections.push(
      "",
      "Planning lane contract:",
      "- This readiness check is for `orc plan`, not direct candidate execution.",
      "- Decide semantically whether the request is clear enough to create a useful, executable consultation plan.",
      "- Prefer needs-clarification when the plan would lack a concrete result contract, scope boundary, or judging basis.",
      "- Ask exactly one operator-answerable clarification question when one answer would make the plan more faithful to intent.",
      "- Do not ask the operator for repository inspection, command flags, or implementation details.",
    );
  }

  appendResultIntentContext(sections, request.taskPacket);
  appendArtifactIntentContext(sections, request.taskPacket);
  appendTaskSourceContext(sections, request.taskPacket);
  appendStructuredResearchContext(sections, request.taskPacket);
  appendResearchSignalDriftContext(
    sections,
    request.taskPacket,
    request.signals.capabilities.map((capability) => `${capability.kind}:${capability.value}`),
  );

  if (request.taskPacket.nonGoals.length > 0) {
    sections.push("", "Non-goals:", ...request.taskPacket.nonGoals.map((item) => `- ${item}`));
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
    `Detected package manager: ${request.signals.packageManager}`,
    `Detected scripts: ${request.signals.scripts.join(", ") || "none"}`,
    `Detected notable files: ${request.signals.files.join(", ") || "none"}`,
    `Detected workspace roots: ${request.signals.workspaceRoots.join(", ") || "none"}`,
    `Detected dependencies: ${request.signals.dependencies.slice(0, 20).join(", ") || "none"}`,
  );

  if (request.signals.capabilities.length > 0) {
    sections.push(
      "",
      "Detected capabilities:",
      ...request.signals.capabilities.map((capability) =>
        [
          `- ${capability.kind}:${capability.value}`,
          `source=${capability.source}`,
          `confidence=${capability.confidence}`,
          ...(capability.path ? [`path=${capability.path}`] : []),
          ...(capability.detail ? [`detail=${capability.detail}`] : []),
        ].join(" "),
      ),
    );
  }

  if (request.signals.notes.length > 0) {
    sections.push("", "Repository notes:", ...request.signals.notes.map((note) => `- ${note}`));
  }

  sections.push(
    "",
    "Rules:",
    "- Prefer proceed when the repository and task already provide enough grounding for a safe tournament run.",
    "- Prefer needs-clarification when one short operator answer would unlock safe execution.",
    "- Prefer external-research-required when correctness depends on official external docs or version facts that are not already grounded in the repository.",
    "- When checking repository evidence, do not assume docs/ or internal/ exist; use those paths only when present or task-relevant.",
    "- Do not invent repository facts, target files, commands, or external citations.",
    "- Keep the summary and any question concise and concrete.",
    "- Clarification questions must resolve a missing result contract, scope boundary, or judging basis.",
    "- Return JSON only.",
  );

  appendResearchBriefDecisionRules(sections, request.taskPacket);

  return `${sections.join("\n")}\n`;
}
